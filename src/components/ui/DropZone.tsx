"use client";

import { useRef, useState } from "react";
import { FolderDown } from "lucide-react";
import { filesFromDataTransfer, hasFiles } from "@/lib/dnd-client";

/**
 * Anything inside becomes a drop target for files and folders: while something is dragged over it
 * a dashed frame and a label appear, and on the drop every file (folders walked) goes to onFiles.
 * Marked data-dropzone so the page-wide drop (which feeds the documents page) leaves it alone.
 */
export function DropZone({ onFiles, label = "Drop files or folders here", children, className = "", disabled = false, as: Tag = "div" }: { onFiles: (files: File[]) => void; label?: string; children: React.ReactNode; className?: string; disabled?: boolean; as?: "div" | "li" | "label" | "span" }) {
  const [over, setOver] = useState(0);
  const depth = useRef(0);
  const props = disabled
    ? {}
    : {
        onDragEnter: (e: React.DragEvent) => {
          if (!hasFiles(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          depth.current++;
          setOver(depth.current);
        },
        onDragOver: (e: React.DragEvent) => {
          if (!hasFiles(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
        },
        onDragLeave: (e: React.DragEvent) => {
          if (!hasFiles(e.dataTransfer)) return;
          e.stopPropagation();
          depth.current = Math.max(0, depth.current - 1);
          setOver(depth.current);
        },
        onDrop: async (e: React.DragEvent) => {
          if (!hasFiles(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          depth.current = 0;
          setOver(0);
          const files = await filesFromDataTransfer(e.dataTransfer);
          if (files.length) onFiles(files);
        },
      };
  return (
    <Tag data-dropzone="" className={`relative ${className}`} {...props}>
      {children}
      {over > 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-xl border-2 border-dashed border-navy bg-navy/10 text-sm font-semibold text-navy">
          <span className="flex items-center gap-2 rounded-lg bg-white/90 px-3 py-1.5 shadow-sm">
            <FolderDown size={16} /> {label}
          </span>
        </div>
      )}
    </Tag>
  );
}
