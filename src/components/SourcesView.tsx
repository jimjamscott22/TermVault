import React, { useMemo, useRef, useState } from 'react';
import {
  CheckSquare,
  FileCode2,
  FilePlus2,
  FolderUp,
  Search,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import { SourceFile } from '../types/backup';
import { bytesToBase64, formatBytes } from '../services/cryptoEngine';

interface SourcesViewProps {
  sources: SourceFile[];
  pendingDiff: { added: string[]; modified: string[]; deleted: string[]; unchanged: string[] };
  onUpsertSource: (file: SourceFile) => Promise<void>;
  onAddSourcesBatch: (files: SourceFile[]) => Promise<void>;
  onToggleInclude: (path: string) => Promise<void>;
  onDeleteSource: (path: string) => void;
  onRunBackup: (mode: 'incremental' | 'full') => void;
  backupRunning: boolean;
}

export const SourcesView: React.FC<SourcesViewProps> = ({
  sources,
  pendingDiff,
  onUpsertSource,
  onAddSourcesBatch,
  onToggleInclude,
  onDeleteSource,
  onRunBackup,
  backupRunning,
}) => {
  const [search, setSearch] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(sources[0]?.path ?? null);
  const [draftContent, setDraftContent] = useState<string>('');
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [creatingFile, setCreatingFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState('/etc/termvault/custom.conf');
  const [newFileContent, setNewFileContent] = useState('# Custom configuration\ncompression = "gzip"\n');
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);

  const modifiedSet = useMemo(() => new Set(pendingDiff.modified), [pendingDiff.modified]);
  const addedSet = useMemo(() => new Set(pendingDiff.added), [pendingDiff.added]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter(
      (f) => f.path.toLowerCase().includes(q) || f.directory.toLowerCase().includes(q)
    );
  }, [sources, search]);

  const selectedFile = useMemo(
    () => sources.find((s) => s.path === selectedPath) ?? null,
    [sources, selectedPath]
  );

  const includedCount = sources.filter((f) => f.included).length;
  const includedBytes = sources.filter((f) => f.included).reduce((s, f) => s + f.size, 0);

  const openEditor = (file: SourceFile) => {
    setSelectedPath(file.path);
    setEditingPath(file.path);
    setDraftContent(file.encoding === 'utf8' ? file.content : '');
  };

  const handleSaveEdit = async () => {
    if (!selectedFile || selectedFile.encoding !== 'utf8') return;
    const encodedSize = new TextEncoder().encode(draftContent).byteLength;
    await onUpsertSource({
      ...selectedFile,
      content: draftContent,
      size: encodedSize,
      lastModified: Date.now(),
    });
    setEditingPath(null);
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    let normalized = newFilePath.trim();
    if (!normalized) return;
    if (!normalized.startsWith('/')) normalized = `/${normalized}`;
    const lastSlash = normalized.lastIndexOf('/');
    const directory = lastSlash > 0 ? normalized.slice(0, lastSlash) : '/';
    const name = normalized.slice(lastSlash + 1) || 'untitled.conf';
    const size = new TextEncoder().encode(newFileContent).byteLength;

    const created: SourceFile = {
      path: normalized,
      directory,
      name,
      mimeType: 'text/plain',
      size,
      lastModified: Date.now(),
      encoding: 'utf8',
      content: newFileContent,
      included: true,
      permissions: '-rw-r--r--',
    };
    await onUpsertSource(created);
    setSelectedPath(created.path);
    setCreatingFile(false);
    setNewFilePath('/etc/termvault/service.conf');
    setNewFileContent('# New configuration file\n');
  };

  const ingestBrowserFiles = async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;

    const parsed: SourceFile[] = [];
    for (const file of arr) {
      // Limit individual browser-ingested files to 4 MB to keep IndexedDB & Drive JSON crisp
      if (file.size > 4 * 1024 * 1024) continue;
      const relPath =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const fullPath = `/home/ops/imports/${relPath.replace(/^\/+/, '')}`;
      const lastSlash = fullPath.lastIndexOf('/');
      const directory = lastSlash > 0 ? fullPath.slice(0, lastSlash) : '/home/ops/imports';
      const name = fullPath.slice(lastSlash + 1);

      const isText =
        file.type.startsWith('text/') ||
        file.type === 'application/json' ||
        /\.(txt|md|json|yml|yaml|conf|cfg|ini|sh|py|ts|tsx|js|css|html|toml|log|env|service|lua)$/i.test(
          name
        );

      if (isText) {
        const text = await file.text();
        parsed.push({
          path: fullPath,
          directory,
          name,
          mimeType: file.type || 'text/plain',
          size: file.size,
          lastModified: file.lastModified || Date.now(),
          encoding: 'utf8',
          content: text,
          included: true,
          permissions: '-rw-r--r--',
        });
      } else {
        const buf = new Uint8Array(await file.arrayBuffer());
        parsed.push({
          path: fullPath,
          directory,
          name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          lastModified: file.lastModified || Date.now(),
          encoding: 'base64',
          content: bytesToBase64(buf),
          included: true,
          permissions: '-rw-r--r--',
        });
      }
    }

    if (parsed.length > 0) {
      await onAddSourcesBatch(parsed);
      setSelectedPath(parsed[0].path);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) {
      await ingestBrowserFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header summary bar */}
      <div className="flex flex-col gap-4 rounded-lg border border-[#222933] bg-[#12161C] p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#E6EDF3]">Linux Backup Sources</h2>
          <p className="mt-1 text-sm text-[#8B949E]">
            {includedCount} of {sources.length} paths selected ·{' '}
            <span className="font-mono tabular-nums text-[#C9D1D9]">
              {formatBytes(includedBytes)}
            </span>{' '}
            active dataset ·{' '}
            <span className="font-mono tabular-nums text-emerald-400">
              {pendingDiff.added.length} new, {pendingDiff.modified.length} modified
            </span>{' '}
            since last snapshot
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) ingestBrowserFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={dirInputRef}
            type="file"
            multiple
            {...({ webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) ingestBrowserFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-md border border-[#2B3442] bg-[#161B22] px-3.5 py-2 text-xs font-medium text-[#E6EDF3] transition-colors hover:bg-[#1E2530] focus-visible:outline-2 focus-visible:outline-emerald-400 whitespace-nowrap shrink-0"
          >
            <Upload className="h-3.5 w-3.5 text-[#8B949E]" />
            Import Files
          </button>
          <button
            type="button"
            onClick={() => dirInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-md border border-[#2B3442] bg-[#161B22] px-3.5 py-2 text-xs font-medium text-[#E6EDF3] transition-colors hover:bg-[#1E2530] focus-visible:outline-2 focus-visible:outline-emerald-400 whitespace-nowrap shrink-0"
          >
            <FolderUp className="h-3.5 w-3.5 text-[#8B949E]" />
            Import Folder
          </button>
          <button
            type="button"
            onClick={() => setCreatingFile((prev) => !prev)}
            className="inline-flex items-center gap-2 rounded-md border border-[#2B3442] bg-[#161B22] px-3.5 py-2 text-xs font-medium text-[#E6EDF3] transition-colors hover:bg-[#1E2530] focus-visible:outline-2 focus-visible:outline-emerald-400 whitespace-nowrap shrink-0"
          >
            <FilePlus2 className="h-3.5 w-3.5 text-[#8B949E]" />
            New File
          </button>
          <button
            type="button"
            disabled={backupRunning || includedCount === 0}
            onClick={() => onRunBackup('incremental')}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-[#07110C] transition-colors hover:bg-emerald-400 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-emerald-400 whitespace-nowrap shrink-0"
          >
            Run Incremental Backup
          </button>
        </div>
      </div>

      {creatingFile && (
        <form
          onSubmit={handleCreateFile}
          className="space-y-4 rounded-lg border border-[#2B3442] bg-[#12161C] p-5"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#E6EDF3]">Create Linux Configuration File</h3>
            <button
              type="button"
              onClick={() => setCreatingFile(false)}
              className="text-xs text-[#8B949E] hover:text-[#E6EDF3]"
            >
              Cancel
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="new-file-path"
                className="mb-1.5 block text-xs font-medium text-[#8B949E]"
              >
                Absolute Path
              </label>
              <input
                id="new-file-path"
                type="text"
                value={newFilePath}
                onChange={(e) => setNewFilePath(e.target.value)}
                required
                className="w-full rounded-md border border-[#2B3442] bg-[#0B0E11] px-3 py-2 font-mono text-xs text-[#E6EDF3] focus:border-emerald-400 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="new-file-content"
              className="mb-1.5 block text-xs font-medium text-[#8B949E]"
            >
              File Contents
            </label>
            <textarea
              id="new-file-content"
              rows={5}
              value={newFileContent}
              onChange={(e) => setNewFileContent(e.target.value)}
              className="w-full rounded-md border border-[#2B3442] bg-[#0B0E11] p-3 font-mono text-xs text-[#E6EDF3] focus:border-emerald-400 focus:outline-none"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-[#07110C] hover:bg-emerald-400"
            >
              Save File to Sources
            </button>
          </div>
        </form>
      )}

      {/* Split Workspace: File Tree Table + File Inspector/Editor */}
      <div className="grid gap-6 xl:grid-cols-12">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`flex flex-col rounded-lg border bg-[#12161C] xl:col-span-7 ${
            dragOver ? 'border-emerald-400' : 'border-[#222933]'
          }`}
        >
          <div className="flex items-center justify-between gap-3 border-b border-[#1E242D] px-5 py-3.5">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6E7681]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by path (e.g. /etc, /var/lib, .conf)..."
                aria-label="Filter backup source files"
                className="w-full rounded-md border border-[#222933] bg-[#0B0E11] py-1.5 pl-8 pr-3 font-mono text-xs text-[#E6EDF3] placeholder-[#6E7681] focus:border-emerald-400 focus:outline-none"
              />
            </div>
            <span className="hidden sm:inline text-xs text-[#6E7681]">
              Drop files here to add
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#1E242D] text-[#8B949E]">
                  <th className="w-10 px-4 py-2.5 font-medium">Use</th>
                  <th className="px-3 py-2.5 font-medium">Path</th>
                  <th className="px-3 py-2.5 font-medium">Delta</th>
                  <th className="px-3 py-2.5 text-right font-medium">Size</th>
                  <th className="w-12 px-4 py-2.5 text-right font-medium">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1A2029]">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-[#8B949E]">
                      No files match your filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((file) => {
                    const isSelected = file.path === selectedPath;
                    const deltaLabel = !file.included
                      ? 'Excluded'
                      : addedSet.has(file.path)
                      ? 'New'
                      : modifiedSet.has(file.path)
                      ? 'Modified'
                      : 'Synced';
                    const deltaClass = !file.included
                      ? 'text-[#6E7681]'
                      : addedSet.has(file.path)
                      ? 'text-emerald-400'
                      : modifiedSet.has(file.path)
                      ? 'text-amber-400'
                      : 'text-[#8B949E]';

                    return (
                      <tr
                        key={file.path}
                        onClick={() => {
                          setSelectedPath(file.path);
                          if (editingPath && editingPath !== file.path) {
                            setEditingPath(null);
                          }
                        }}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-[#18202A]' : 'hover:bg-[#151A22]'
                        }`}
                      >
                        <td
                          className="px-4 py-2.5"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleInclude(file.path);
                          }}
                        >
                          <button
                            type="button"
                            aria-label={`Toggle backup inclusion for ${file.path}`}
                            className="text-[#8B949E] hover:text-emerald-400"
                          >
                            {file.included ? (
                              <CheckSquare className="h-4 w-4 text-emerald-400" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[#E6EDF3]">
                          <div className="max-w-xs truncate sm:max-w-md" title={file.path}>
                            {file.path}
                          </div>
                        </td>
                        <td className={`px-3 py-2.5 font-mono ${deltaClass}`}>{deltaLabel}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[#C9D1D9]">
                          {formatBytes(file.size)}
                        </td>
                        <td
                          className="px-4 py-2.5 text-right"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteSource(file.path);
                          }}
                        >
                          <button
                            type="button"
                            aria-label={`Remove ${file.path}`}
                            className="rounded p-1 text-[#6E7681] hover:bg-[#222933] hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* File Inspector & Live Inline Editor */}
        <div className="flex flex-col rounded-lg border border-[#222933] bg-[#12161C] xl:col-span-5">
          {selectedFile ? (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-[#1E242D] px-5 py-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileCode2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    <h3 className="truncate font-mono text-xs font-semibold text-[#E6EDF3]">
                      {selectedFile.path}
                    </h3>
                  </div>
                  <p className="mt-1 font-mono text-xs text-[#8B949E]">
                    {selectedFile.permissions} · {formatBytes(selectedFile.size)} ·{' '}
                    {selectedFile.encoding}
                  </p>
                </div>

                {selectedFile.encoding === 'utf8' && (
                  <div className="flex items-center gap-2 shrink-0">
                    {editingPath === selectedFile.path ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditingPath(null)}
                          className="rounded-md border border-[#2B3442] px-2.5 py-1.5 text-xs text-[#C9D1D9] hover:bg-[#1E2530]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveEdit}
                          className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-[#07110C] hover:bg-emerald-400"
                        >
                          Save
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openEditor(selectedFile)}
                        className="rounded-md border border-[#2B3442] bg-[#161B22] px-3 py-1.5 text-xs font-medium text-[#E6EDF3] hover:bg-[#1E2530]"
                      >
                        Edit File
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex-1 p-4">
                {selectedFile.encoding === 'utf8' ? (
                  editingPath === selectedFile.path ? (
                    <div className="space-y-2">
                      <textarea
                        value={draftContent}
                        onChange={(e) => setDraftContent(e.target.value)}
                        rows={14}
                        aria-label={`Edit content of ${selectedFile.path}`}
                        className="w-full rounded-md border border-emerald-500/50 bg-[#0B0E11] p-3 font-mono text-xs leading-relaxed text-[#E6EDF3] focus:outline-none"
                      />
                      <p className="text-xs text-[#8B949E]">
                        Saving modifies the SHA-256 checksum so the next incremental backup captures only the changed block.
                      </p>
                    </div>
                  ) : (
                    <pre className="max-h-96 overflow-auto rounded-md border border-[#1E242D] bg-[#0B0E11] p-3.5 font-mono text-xs leading-relaxed text-[#C9D1D9]">
                      {selectedFile.content}
                    </pre>
                  )
                ) : (
                  <div className="flex h-64 flex-col items-center justify-center rounded-md border border-[#1E242D] bg-[#0B0E11] p-6 text-center">
                    <p className="text-sm font-medium text-[#E6EDF3]">Binary File Asset</p>
                    <p className="mt-1 font-mono text-xs text-[#8B949E]">
                      {selectedFile.mimeType} · {formatBytes(selectedFile.size)}
                    </p>
                    <p className="mt-3 max-w-xs text-xs text-[#6E7681]">
                      Binary files are split into 16 KB SHA-256 content-addressed chunks and encrypted with AES-256-GCM during backup.
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex h-64 items-center justify-center p-6 text-sm text-[#8B949E]">
              Select a source file to inspect or modify its contents.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
