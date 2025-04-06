import React, { useEffect, useRef } from 'react';
import { Terminal, ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import io, { Socket } from 'socket.io-client';
import '@xterm/xterm/css/xterm.css';

interface PtyOutputData {
  output: string;
}

interface ResizeDimensions {
  cols: number;
  rows: number;
}

// Debounce function (utility)
function debounce<T extends (...args: any[]) => void>(func: T, wait_ms: number) {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>): void => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      func(...args);
    }, wait_ms);
  };
}

const XtermTerminal: React.FC = () => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddonInstance = useRef<FitAddon | null>(null);
  const socketInstance = useRef<Socket | null>(null);

  const terminalOptions: ITerminalOptions = {
    cursorBlink: true,
    macOptionIsMeta: true,
    scrollback: 1000, // Example scrollback
    fontSize: 14,     // Example font size
    fontFamily: 'monospace', // Example font family
    theme: {          // Example theme (optional)
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
    }
  };

  // --- Helper Functions ---

  const fitToscreen = () => {
    if (fitAddonInstance.current && termInstance.current && socketInstance.current?.connected) {
      try {
        fitAddonInstance.current.fit();
        const dims: ResizeDimensions = {
          cols: termInstance.current.cols,
          rows: termInstance.current.rows,
        };
        console.log("Sending new dimensions to server's pty", dims);
        socketInstance.current.emit("resize", dims);
      } catch (err) {
        console.error("Error resizing terminal:", err);
      }
    }
  };

  const customKeyEventHandler = (e: KeyboardEvent): boolean => {
    if (e.type !== "keydown") {
      return true;
    }
    // Use `metaKey` for Cmd on macOS, `ctrlKey` elsewhere for consistency?
    // Or stick to Ctrl+Shift as defined.
    if (e.ctrlKey && e.shiftKey) {
      const key = e.key.toLowerCase();
      if (key === "v") {
        e.preventDefault(); // Prevent potential browser default paste action
        navigator.clipboard.readText().then((toPaste) => {
          termInstance.current?.write(toPaste); // Use write, not writeText for potentially complex paste
        }).catch(err => {
          console.error("Failed to read clipboard contents: ", err);
        });
        return false; // Prevent event propagation
      } else if (key === "c" || key === "x") {
        e.preventDefault(); // Prevent potential browser default copy/cut action
        const term = termInstance.current;
        if (term?.hasSelection()) {
          const toCopy = term.getSelection();
          navigator.clipboard.writeText(toCopy).then(() => {
            term.focus(); // Refocus after successful copy
            term.clearSelection(); // Optionally clear selection
          }).catch(err => {
            console.error("Failed to copy text to clipboard: ", err);
          });
        }
        return false; // Prevent event propagation
      }
    }
    return true; // Allow other keys to be processed by xterm/pty
  };

  // --- useEffect for Initialization and Cleanup ---

  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }

    // --- Initialize Terminal ---
    const term = new Terminal(terminalOptions);
    termInstance.current = term;

    // --- Load Addons ---
    const fitAddon = new FitAddon();
    fitAddonInstance.current = fitAddon;
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);

    // --- Attach Custom Key Handler ---
    term.attachCustomKeyEventHandler(customKeyEventHandler);

    // --- Open Terminal in DOM ---
    term.open(terminalRef.current);

    // --- Initial Fit and Welcome Message ---
    // Small delay to ensure layout is stable before first fit
    setTimeout(() => {
      // term.resize(15, 50); // This might be overridden by fit immediately
      // console.log(`Initial size attempt: ${term.cols} columns, ${term.rows} rows`);
      fitAddon.fit();
      term.writeln("Welcome to xterm!");
      term.focus(); // Focus the terminal
    }, 50); // Adjust delay if needed


    // --- Setup Terminal Data Listener ---
    const dataListener = term.onData((data) => {
      socketInstance.current?.emit("pty-input", { input: data });
    });

    // --- Initialize Socket.IO ---
    const socket = io("ws://localhost:5000/pty", {
      // Optional: Add connection options if needed
      transports: ['websocket'], // Example: Force websocket
    });
    socketInstance.current = socket;

    // --- Setup Socket Event Listeners ---
    socket.on("connect", () => {
      // Fit after connection established and state is updated
      // Use setTimeout to ensure DOM/layout updates related to connection status are done
      setTimeout(fitToscreen, 0);
    });

    socket.on("disconnect", () => {
      term.writeln("\r\n\x1b[31m--- disconnected ---\x1b[0m"); // Notify in terminal
    });

    socket.on("pty-output", (data: PtyOutputData | string) => {
      // Handle both object {output: string} and raw string data
      const output = typeof data === 'object' && data !== null && 'output' in data ? data.output : data as string;
      // console.log("New output received from server:", output); // Can be very verbose
      term.write(output);
    });

    socket.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
      term.writeln(`\r\n\x1b[31m--- connection error: ${err.message} ---\x1b[0m`);
    });


    // --- Setup Window Resize Listener ---
    const debouncedFit = debounce(fitToscreen, 50);
    window.addEventListener('resize', debouncedFit);

    // --- Cleanup Function ---
    return () => {
      console.log("Cleaning up terminal component...");
      // Remove listeners
      window.removeEventListener('resize', debouncedFit);
      dataListener.dispose(); // Dispose xterm listeners
      socket.off("connect");
      socket.off("disconnect");
      socket.off("pty-output");
      socket.off("connect_error");

      // Disconnect socket
      socket.disconnect();
      socketInstance.current = null;

      // Dispose terminal
      term.dispose();
      termInstance.current = null;
      fitAddonInstance.current = null; // Clear addon ref too
    };
  }, []); // Empty dependency array ensures this runs only once on mount and cleanup on unmount

  return (
    <div
      id="terminal-container"
      ref={terminalRef}
      style={{ height: '100%', width: '100%', backgroundColor: '#1E1E1E' }} // Example styling - adjust height/width as needed
    ></div>
  );
};

export default XtermTerminal;