import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { APP_NAME } from "@/lib/brand";
import { APPEARANCE_BOOT } from "@/lib/appearance";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Monthly commercial reporting for construction programmes",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

/**
 * Every box that takes text asks the browser for its spell check and its writing suggestions
 * (Microsoft Edge's Editor and Copilot text prediction, Chrome's as well): the attributes are set
 * on what is on the page now and on whatever is added later. Passwords, e-mails and figures are left alone.
 */
const WRITING_AIDS_BOOT = `(function(){
  var skip = { password: 1, email: 1, number: 1, date: 1, time: 1, url: 1, tel: 1, file: 1, checkbox: 1, radio: 1, hidden: 1, submit: 1, button: 1, color: 1, range: 1 };
  function mark(el) {
    if (!el || el.nodeType !== 1) return;
    var tag = el.tagName;
    if (tag === "TEXTAREA" || (tag === "INPUT" && !skip[(el.getAttribute("type") || "text").toLowerCase()]) || el.isContentEditable) {
      if (!el.hasAttribute("spellcheck")) el.setAttribute("spellcheck", "true");
      if (!el.hasAttribute("writingsuggestions")) el.setAttribute("writingsuggestions", "true");
      if (!el.hasAttribute("lang")) el.setAttribute("lang", "en-GB");
    }
  }
  function sweep(root) {
    mark(root);
    if (root.querySelectorAll) root.querySelectorAll("input, textarea, [contenteditable]").forEach(mark);
  }
  function start() {
    sweep(document.body);
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) muts[i].addedNodes.forEach(sweep);
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${geistSans.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* the saved look is applied before the first paint, so it never flashes the default first */}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOT }} />
      </head>
      <body className="min-h-full">
        {children}
        <script dangerouslySetInnerHTML={{ __html: WRITING_AIDS_BOOT }} />
      </body>
    </html>
  );
}
