'use client'

/**
 * The workspace's organisation: folders, collections, tags in use and your saved searches, plus the actions that change
 * them. Shared by the Library, Uploads, the asset page and the command menu.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Collection, FieldType, Folder, MetadataField, SavedSearch, SearchQuery, TagCount } from '@/lib/media/types'
import { useMedia } from './media'
import { toast } from './ui'

export async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {}
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json', ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: 'no-store',
  })
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error || `Request failed (${res.status})`)
  return body as T
}

type BulkAction = { action: 'move'; folderId: string | null } | { action: 'tag' | 'untag'; tags: string[] } | { action: 'meta'; field: string; value: unknown } | { action: 'delete' }
export type FieldInput = { label: string; type?: FieldType; options?: string[]; required?: boolean; help?: string | null }

type Library = {
  folders: Folder[]
  collections: Collection[]
  tags: TagCount[]
  searches: SavedSearch[]
  fields: MetadataField[]
  ready: boolean
  reload: () => Promise<void>
  folderPath: (id: string | null | undefined) => Folder[]
  createFolder: (name: string, parentId: string | null) => Promise<Folder | null>
  renameFolder: (id: string, name: string) => Promise<boolean>
  moveFolder: (id: string, parentId: string | null) => Promise<boolean>
  deleteFolder: (id: string) => Promise<boolean>
  createCollection: (name: string, description?: string) => Promise<Collection | null>
  renameCollection: (id: string, name: string) => Promise<boolean>
  deleteCollection: (id: string) => Promise<boolean>
  collect: (id: string, ids: string[], remove?: boolean) => Promise<boolean>
  bulk: (ids: string[], what: BulkAction) => Promise<boolean>
  saveSearch: (name: string, query: SearchQuery) => Promise<boolean>
  deleteSearch: (id: string) => Promise<boolean>
  saveField: (id: string | null, input: FieldInput) => Promise<boolean>
  deleteField: (id: string) => Promise<boolean>
  reorderFields: (ids: string[]) => Promise<boolean>
}

const Ctx = createContext<Library | null>(null)

export function useLibrary() {
  const l = useContext(Ctx)
  if (!l) throw new Error('useLibrary must be used inside <LibraryProvider>')
  return l
}

const fail = (e: unknown, fallback: string) => {
  toast(e instanceof Error ? e.message : fallback)
  return false as const
}

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const media = useMedia()
  const [folders, setFolders] = useState<Folder[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [tags, setTags] = useState<TagCount[]>([])
  const [searches, setSearches] = useState<SavedSearch[]>([])
  const [fields, setFields] = useState<MetadataField[]>([])
  const [ready, setReady] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [f, c, t, s, m] = await Promise.all([
        request<{ folders: Folder[] }>('/api/folders'),
        request<{ collections: Collection[] }>('/api/collections'),
        request<{ tags: TagCount[] }>('/api/tags'),
        request<{ searches: SavedSearch[] }>('/api/searches'),
        request<{ fields: MetadataField[] }>('/api/fields'),
      ])
      setFields(m.fields)
      setFolders(f.folders)
      setCollections(c.collections)
      setTags(t.tags)
      setSearches(s.searches)
      setReady(true)
    } catch {
      /* keep what we have */
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // counts and tags follow the asset list (uploads finishing, edits made elsewhere)
  const assetCount = media.assets.length
  const tagSignature = media.assets.map((a) => a.tags.join(',') + a.folderId).join('|')
  useEffect(() => {
    if (ready) void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetCount, tagSignature])

  const folderPath = useCallback(
    (id: string | null | undefined) => {
      const out: Folder[] = []
      let cur = folders.find((f) => f.id === id)
      for (let guard = 0; cur && guard < 50; guard++) {
        out.unshift(cur)
        const parent: string | null = cur.parentId
        cur = folders.find((f) => f.id === parent)
      }
      return out
    },
    [folders],
  )

  const after = useCallback(async () => {
    await Promise.all([reload(), media.refresh()])
  }, [reload, media])

  const value = useMemo<Library>(
    () => ({
      folders,
      collections,
      tags,
      searches,
      fields,
      ready,
      reload,
      folderPath,
      createFolder: async (name, parentId) => {
        try {
          const { folder } = await request<{ folder: Folder }>('/api/folders', { method: 'POST', json: { name, parentId } })
          await reload()
          return folder
        } catch (e) {
          fail(e, 'Couldn’t create the folder.')
          return null
        }
      },
      renameFolder: async (id, name) => {
        try {
          const { folders } = await request<{ folders: Folder[] }>(`/api/folders/${id}`, { method: 'PATCH', json: { name } })
          setFolders(folders)
          return true
        } catch (e) {
          return fail(e, 'Couldn’t rename the folder.')
        }
      },
      moveFolder: async (id, parentId) => {
        try {
          const { folders } = await request<{ folders: Folder[] }>(`/api/folders/${id}`, { method: 'PATCH', json: { parentId } })
          setFolders(folders)
          return true
        } catch (e) {
          return fail(e, 'Couldn’t move the folder.')
        }
      },
      deleteFolder: async (id) => {
        try {
          await request(`/api/folders/${id}`, { method: 'DELETE' })
          await after()
          return true
        } catch (e) {
          return fail(e, 'Couldn’t delete the folder.')
        }
      },
      createCollection: async (name, description) => {
        try {
          const { collection } = await request<{ collection: Collection }>('/api/collections', { method: 'POST', json: { name, description } })
          await reload()
          return collection
        } catch (e) {
          fail(e, 'Couldn’t create the collection.')
          return null
        }
      },
      renameCollection: async (id, name) => {
        try {
          await request(`/api/collections/${id}`, { method: 'PATCH', json: { name } })
          await reload()
          return true
        } catch (e) {
          return fail(e, 'Couldn’t rename the collection.')
        }
      },
      deleteCollection: async (id) => {
        try {
          await request(`/api/collections/${id}`, { method: 'DELETE' })
          await after()
          return true
        } catch (e) {
          return fail(e, 'Couldn’t delete the collection.')
        }
      },
      collect: async (id, ids, remove) => {
        try {
          await request(`/api/collections/${id}/${remove ? 'remove' : 'add'}`, { method: 'POST', json: { ids } })
          await after()
          return true
        } catch (e) {
          return fail(e, 'Couldn’t update the collection.')
        }
      },
      bulk: async (ids, what) => {
        try {
          await request('/api/assets/bulk', { method: 'POST', json: { ids, ...what } })
          await after()
          return true
        } catch (e) {
          return fail(e, 'Couldn’t update those assets.')
        }
      },
      saveSearch: async (name, query) => {
        try {
          const { searches } = await request<{ searches: SavedSearch[] }>('/api/searches', { method: 'POST', json: { name, query } })
          setSearches(searches)
          return true
        } catch (e) {
          return fail(e, 'Couldn’t save the search.')
        }
      },
      saveField: async (id, input) => {
        try {
          const { fields } = await request<{ fields: MetadataField[] }>(id ? `/api/fields/${id}` : '/api/fields', { method: id ? 'PATCH' : 'POST', json: input })
          setFields(fields)
          return true
        } catch (e) {
          return fail(e, 'Couldn’t save the field.')
        }
      },
      deleteField: async (id) => {
        try {
          const { fields } = await request<{ fields: MetadataField[] }>(`/api/fields/${id}`, { method: 'DELETE' })
          setFields(fields)
          await media.refresh()
          return true
        } catch (e) {
          return fail(e, 'Couldn’t delete the field.')
        }
      },
      reorderFields: async (ids) => {
        try {
          const { fields } = await request<{ fields: MetadataField[] }>('/api/fields/reorder', { method: 'POST', json: { ids } })
          setFields(fields)
          return true
        } catch (e) {
          return fail(e, 'Couldn’t reorder the fields.')
        }
      },
      deleteSearch: async (id) => {
        try {
          const { searches } = await request<{ searches: SavedSearch[] }>(`/api/searches/${id}`, { method: 'DELETE' })
          setSearches(searches)
          return true
        } catch (e) {
          return fail(e, 'Couldn’t delete the saved search.')
        }
      },
    }),
    [folders, collections, tags, searches, fields, ready, reload, folderPath, after, media],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Folders as an indented, depth-first list (for pickers). */
export function flatTree(folders: Folder[], parentId: string | null = null, depth = 0): { folder: Folder; depth: number }[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((f) => [{ folder: f, depth }, ...flatTree(folders, f.id, depth + 1)])
}
