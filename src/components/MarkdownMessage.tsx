import { useMemo, type ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidBlock } from "./MermaidBlock";

type Props = {
  content: string;
  /** While tokens stream in, skip Mermaid render (fence is often incomplete). */
  streaming?: boolean;
};

const DIAGRAM_PENDING_MARKER = "SEECOG_DIAGRAM_PENDING";
const REMARK_PLUGINS = [remarkGfm];

function isMermaidChild(children: ReactNode): boolean {
  const child = Array.isArray(children) ? children[0] : children;
  if (!child || typeof child !== "object" || !("props" in child)) return false;
  const className = (child as { props?: { className?: string } }).props
    ?.className;
  return typeof className === "string" && className.includes("language-mermaid");
}

function codeText(children: ReactNode): string {
  if (children == null) return "";
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    // react-markdown often yields one string per line without "\n" nodes.
    // Joining with "" glues "flowchart TB" + "node..." into "flowchart TBnode".
    return children.map(codeText).join("\n");
  }
  if (typeof children === "object" && "props" in children) {
    return codeText(
      (children as { props?: { children?: ReactNode } }).props?.children,
    );
  }
  return "";
}

/** Hide Mermaid source while streaming — show a calm placeholder instead. */
function maskMermaidWhileStreaming(content: string): string {
  let text = content.replace(/```mermaid[\s\S]*?```/gi, () => {
    return `\n\n${DIAGRAM_PENDING_MARKER}\n\n`;
  });
  // Incomplete fence still open at the end of the stream buffer.
  if (/```mermaid/i.test(text)) {
    text = text.replace(/```mermaid[\s\S]*$/i, `\n\n${DIAGRAM_PENDING_MARKER}\n\n`);
  }
  return text;
}

function DiagramPending() {
  return (
    <div className="arch-viewer arch-viewer--pending" aria-busy="true">
      <div className="arch-viewer__pending-inner">
        <span className="arch-viewer__pending-bar" />
        <p>Drawing diagram…</p>
      </div>
    </div>
  );
}

function buildComponents(streaming: boolean): Components {
  return {
    code({ className, children, ...rest }) {
      const match = /language-(\w+)/.exec(className || "");
      const language = match?.[1]?.toLowerCase();
      const code = codeText(children).replace(/\n$/, "");

      if (language === "mermaid") {
        if (streaming) return <DiagramPending />;
        return <MermaidBlock chart={code} />;
      }

      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    },
    pre({ children }) {
      if (isMermaidChild(children)) {
        return <>{children}</>;
      }
      return <pre>{children}</pre>;
    },
    p({ children }) {
      const text = codeText(children).trim();
      if (text === DIAGRAM_PENDING_MARKER) {
        return <DiagramPending />;
      }
      return <p>{children}</p>;
    },
  };
}

export function MarkdownMessage({ content, streaming = false }: Props) {
  if (streaming && !content.trim()) {
    return (
      <div className="md md--streaming md--waiting">
        <p className="stream-waiting">Analyzing…</p>
        <span className="stream-cursor" aria-hidden="true" />
      </div>
    );
  }

  const display = streaming ? maskMermaidWhileStreaming(content) : content;
  // Stable across stream chunks — new `components` every render remounts the tree and flickers.
  const components = useMemo(
    () => buildComponents(streaming),
    [streaming],
  );

  return (
    <div className={streaming ? "md md--streaming" : "md"}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {display}
      </ReactMarkdown>
      {streaming ? <span className="stream-cursor" aria-hidden="true" /> : null}
    </div>
  );
}
