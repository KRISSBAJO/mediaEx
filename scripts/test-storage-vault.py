"""Disposable Linux/Docker integration test. No production endpoints or credentials."""
import hashlib
import json
import os
import secrets
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BAO = "ghcr.io/openbao/openbao:2.7.3"
MINIO = "minio/minio:RELEASE.2025-09-07T16-13-09Z"
MC = "minio/mc:RELEASE.2025-08-13T08-35-41Z"
REPO = Path(__file__).resolve().parents[1]
VAULT_PATH = "mediaex/data/workspaces/studio-a/storage"


def run(args, *, env=None, data=None):
    # Commands can contain fixture credentials. Never echo argv or stderr.
    p = subprocess.run(args, input=data, capture_output=True, env=env, cwd=REPO, timeout=240)
    if p.returncode:
        raise RuntimeError(f"{Path(args[0]).name} failed during {phase} (exit {p.returncode})")
    return p.stdout


def api(base, path, token="", body=None, method=None):
    payload = json.dumps(body).encode() if isinstance(body, dict) else body
    headers = {"Content-Type": "application/json" if not isinstance(body, bytes) else "application/octet-stream"}
    if token:
        headers["X-Vault-Token"] = token
    try:
        with urlopen(Request(base + "/v1/" + path, data=payload, headers=headers, method=method), timeout=15) as r:
            return r.status, r.read()
    except HTTPError as e:
        return e.code, e.read()


def ok(base, path, token="", body=None, method=None):
    status, raw = api(base, path, token, body, method)
    if status not in (200, 204):
        raise RuntimeError(f"OpenBao {path} returned HTTP {status} during {phase}")
    return json.loads(raw) if raw else {}


def wait(probe):
    for _ in range(90):
        try:
            if probe():
                return
        except (URLError, TimeoutError, ConnectionError):
            pass
        time.sleep(1)
    raise RuntimeError("Readiness timed out during " + phase)


def port(name, number):
    return "http://" + run(["docker", "port", name, str(number) + "/tcp"]).decode().splitlines()[0]


def start_bao(name, folder):
    config = folder / "bao.hcl"
    config.write_text('disable_mlock = true\napi_addr = "http://127.0.0.1:8200"\ncluster_addr = "https://127.0.0.1:8201"\n'
                      'listener "tcp" {\n address = "0.0.0.0:8200"\n tls_disable = true\n}\n'
                      'storage "raft" {\n path = "/tmp/raft"\n node_id = "fixture"\n}\n')
    run(["docker", "run", "-d", "--name", name, "-p", "127.0.0.1::8200", "--user", "0", "--tmpfs", "/tmp/raft:mode=0700",
         "-v", f"{config}:/tmp/pilot.hcl:ro", "--entrypoint", "bao", BAO, "server", "-config=/tmp/pilot.hcl"])
    addr = port(name, 8200)
    wait(lambda: api(addr, "sys/init")[0] == 200)
    keys = ok(addr, "sys/init", body={"secret_shares": 3, "secret_threshold": 2}, method="PUT")
    for key in keys["keys_base64"][:2]:
        ok(addr, "sys/unseal", body={"key": key}, method="PUT")
    wait(lambda: api(addr, "sys/health")[0] == 200)
    return addr, keys


def token(addr, root, policy, allowed, label, path=VAULT_PATH):
    ok(addr, "sys/policies/acl/" + policy, root, {"policy": f'path "{path}" {{ capabilities = {json.dumps(allowed)} }}'}, "PUT")
    return ok(addr, "auth/token/create", root, {"policies": [policy], "ttl": "20m", "display_name": label})["auth"]["client_token"]


def main(folder):
    global phase
    tag = "mediaex-vault-" + secrets.token_hex(5)
    source, recovered, bucket_host = tag + "-a", tag + "-b", tag + "-s3"
    admin = secrets.token_hex(20)
    bucket = "pilot-media"
    keys = [{"accessKeyId": "key" + secrets.token_hex(6), "secretAccessKey": secrets.token_hex(24)} for _ in range(2)]
    sensitive = [k["secretAccessKey"] for k in keys]
    try:
        phase = "pulling the public fixture images"
        for image in (BAO, MINIO, MC):
            subprocess.run(["docker", "pull", image], check=True, timeout=180)
        phase = "starting OpenBao and MinIO"
        addr, init = start_bao(source, folder)
        root = init["root_token"]
        run(["docker", "run", "-d", "--name", bucket_host, "-p", "127.0.0.1::9000",
             "-e", "MINIO_ROOT_USER=fixtureadmin", "-e", "MINIO_ROOT_PASSWORD=" + admin, MINIO, "server", "/data"])
        endpoint = port(bucket_host, 9000)
        def s3_ready():
            with urlopen(endpoint + "/minio/health/ready", timeout=2) as r:
                return r.status == 200
        wait(s3_ready)
        def mc(*args):
            return run(["docker", "run", "--rm", "--user", "0", "--network", "container:" + bucket_host,
                        "-e", f"MC_HOST_test=http://fixtureadmin:{admin}@127.0.0.1:9000",
                        "-v", f"{folder / 's3.json'}:/tmp/policy.json:ro", MC, *args])
        phase = "creating disposable least-privilege identities"
        s3_policy = {"Version": "2012-10-17", "Statement": [
            {"Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject","s3:AbortMultipartUpload","s3:ListMultipartUploadParts"],
             "Resource": [f"arn:aws:s3:::{bucket}/studio-a/*"]},
            {"Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": [f"arn:aws:s3:::{bucket}"],
             "Condition": {"StringLike": {"s3:prefix": ["studio-a/*"]}}}]}
        (folder / "s3.json").write_text(json.dumps(s3_policy))
        mc("mb", "test/" + bucket)
        mc("admin", "policy", "create", "test", "studio-a", "/tmp/policy.json")
        for k in keys:
            mc("admin", "user", "add", "test", k["accessKeyId"], k["secretAccessKey"])
            mc("admin", "policy", "attach", "test", "studio-a", "--user", k["accessKeyId"])
        ok(addr, "sys/audit/pilot", root, {"type": "file", "options": {"file_path": "/tmp/pilot-audit.jsonl"}})
        ok(addr, "sys/mounts/mediaex", root, {"type": "kv", "options": {"version": "2"}})
        ok(addr, "mediaex/config", root, {"cas_required": True, "max_versions": 20})
        runtime = token(addr, root, "pilot-reader", ["read"], "pilot-runtime")
        operator = token(addr, root, "pilot-writer", ["read", "create", "update"], "pilot-operator")
        other = token(addr, root, "second-studio", ["read"], "second-studio", "mediaex/data/workspaces/studio-b/storage")
        sensitive += [runtime, operator, other, root]
        for name, value in [("runtime", runtime), ("operator", operator), ("keys.json", json.dumps(keys))]:
            (folder / name).write_text(value)
        env = {k: v for k, v in os.environ.items() if not k.startswith(("S3_", "MEDIAEX_VAULT_", "MEDIAEX_S3_", "AWS_"))}
        env.update(MEDIAEX_VAULT_WORKSPACE="studio-a", MEDIAEX_S3_WORKSPACE_IDS="studio-a", MEDIAEX_VAULT_ADDR=addr,
                   MEDIAEX_VAULT_TOKEN_FILE=str(folder / "runtime"), MEDIAEX_VAULT_OPERATOR_TOKEN_FILE=str(folder / "operator"),
                   S3_BUCKET=bucket, S3_REGION="us-east-1", S3_ENDPOINT=endpoint)
        phase = "media proof, rotation and isolation"
        check = subprocess.run(["node", "--experimental-strip-types", "scripts/test-storage-vault.mts", str(folder / "keys.json")],
                               cwd=REPO, env=env, capture_output=True, timeout=180)
        if check.returncode:
            # Stack frames are safe only after removing bearer URLs and fixture secrets.
            import re
            message = re.sub(r'https?://[^\s\x27\x22]+', '[URL]', check.stderr.decode(errors='replace'))
            for value in sensitive + [k['accessKeyId'] for k in keys]:
                message = message.replace(value, '[redacted]')
            raise RuntimeError(message[:2000])
        print(check.stdout.decode().strip(), flush=True)
        assert api(addr, VAULT_PATH, other)[0] == 403
        assert api(addr, VAULT_PATH, runtime, {"options": {"cas": 2}, "data": {}})[0] == 403
        # Try the actual prefix-restricted S3 identity outside its workspace.
        forbidden = subprocess.run(["docker", "run", "--rm", "-i", "--network", "container:" + bucket_host,
                                    "-e", f"MC_HOST_bound=http://{keys[1]['accessKeyId']}:{keys[1]['secretAccessKey']}@127.0.0.1:9000",
                                    MC, "pipe", f"bound/{bucket}/studio-b/forbidden"], input=b"probe", capture_output=True)
        assert forbidden.returncode != 0 and b"denied" in (forbidden.stdout + forbidden.stderr).lower()
        phase = "audit verification"
        audit = run(["docker", "exec", source, "cat", "/tmp/pilot-audit.jsonl"])
        assert all(v.encode() not in audit for v in sensitive)
        entries = [json.loads(line) for line in audit.splitlines()]
        assert any(e.get("request", {}).get("path") == VAULT_PATH and e["request"]["operation"] in ("create", "update")
                   and e.get("auth", {}).get("display_name", "").endswith("pilot-operator") for e in entries)
        print("Passed provider and OpenBao workspace denial, runtime write denial and redacted audit checks.", flush=True)
        phase = "restoring a Raft snapshot onto a fresh cluster"
        code, snapshot = api(addr, "sys/storage/raft/snapshot", root)
        assert code == 200 and snapshot
        snapfile = folder / "storage.snap"
        snapfile.write_bytes(snapshot)
        assert hashlib.sha256(snapfile.read_bytes()).digest() == hashlib.sha256(snapshot).digest()
        run(["docker", "stop", source])
        dest, fresh = start_bao(recovered, folder)
        assert api(dest, VAULT_PATH, runtime)[0] == 403
        code, _ = api(dest, "sys/storage/raft/snapshot-force", fresh["root_token"], snapfile.read_bytes())
        assert code in (200, 204)
        def restored():
            state = ok(dest, "sys/seal-status")
            if state["sealed"]:
                for share in init["keys_base64"][:2]:
                    ok(dest, "sys/unseal", body={"key": share}, method="PUT")
            return api(dest, VAULT_PATH, runtime)[0] == 200
        wait(restored)
        ok(dest, "sys/seal", root, method="PUT")
        assert ok(dest, "sys/seal-status")["sealed"]
        for index, share in enumerate(init["keys_base64"][:2]):
            state = ok(dest, "sys/unseal", body={"key": share}, method="PUT")
            assert state["sealed"] == (index == 0)
        wait(lambda: api(dest, "sys/health")[0] == 200)
        saved = ok(dest, VAULT_PATH, runtime)["data"]
        assert saved["metadata"]["version"] == 2 and saved["data"]["key"] == keys[1]
        assert api(dest, VAULT_PATH, other)[0] == 403
        env["MEDIAEX_VAULT_ADDR"] = dest
        run(["node", "--experimental-strip-types", "--input-type=module", "-e",
             "import { StorageVault } from './backend/media/storage-vault.mts'; "
             "import { proveMedia } from './backend/rotate-storage.mts'; "
             "const vault = new StorageVault('runtime'); await proveMedia(vault, (await vault.current()).record.key)"], env=env)
        print("Passed restore of version 2, workspace policy and media proof on a fresh OpenBao node with source offline.", flush=True)
    finally:
        # These random names belong only to this invocation.
        for name in (recovered, source, bucket_host):
            subprocess.run(["docker", "rm", "-fv", name], capture_output=True, timeout=30)


if __name__ == "__main__":
    os.umask(0o077)
    phase = "setup"
    with tempfile.TemporaryDirectory(prefix="mediaex-test-") as folder:
        main(Path(folder))
