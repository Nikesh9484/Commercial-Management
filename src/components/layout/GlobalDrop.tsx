"use client";

import { useEffect, useState } from "react";
import { filesFromDataTransfer, hasFiles } from "@/lib/dnd-client";
import { AddFromDocuments } from "@/components/changes/AddFromDocuments";

/**
 * Files or folders dropped anywhere on a page – outside the boxes that take their own drops – go to
 * the one-drop feed: each is read and handed to the register it belongs to (changes, bonds and
 * insurance, payments, accommodation leases). The browser's own behaviour (opening the file) is
 * stopped everywhere, so a stray drop never leaves the dashboard.
 */
export function GlobalDrop({ enabled }: { enabled: boolean }) {
  const [files, setFiles] = useState<File[] | null>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let depth = 0;
    const inZone = (t: EventTarget | null) => !!(t as Element | null)?.closest?.("[data-dropzone]");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      depth++;
      if (!inZone(e.target)) setOver(true);
    };
    const overH = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setOver(!inZone(e.target));
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const drop = async (e: DragEvent) => {
      depth = 0;
      setOver(false);
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (inZone(e.target)) return; // a box with its own drop handled it
      const list = await filesFromDataTransfer(e.dataTransfer!);
      if (list.length) setFiles(list);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", overH);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", overH);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [enabled]);
  if (!enabled) return null;
  return (
    <>
      {over && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-end bg-navy/5 p-6">
          <div className="rounded-xl border-2 border-dashed border-navy bg-white px-4 py-2 text-sm font-semibold text-navy shadow-lg">Drop anywhere – the files are read and sent to the register they belong to</div>
        </div>
      )}
      <AddFromDocuments
        endpoint="/api/feed/from-documents"
        title="Documents dropped on the dashboard"
        hideButton
        openWith={files}
        onClosed={() => setFiles(null)}
        intro="Each file is read far enough to tell what it is – a change document, a bond or insurance, a payment application or certificate, a lease agreement – and handed to the register it belongs to. Anything not recognised is listed and left out."
        tip="To file documents under one contract, drop them on that contract's heading in the Contract Library instead."
      />
    </>
  );
}
