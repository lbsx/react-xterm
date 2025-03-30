import React, { memo, useEffect, useRef, useCallback } from 'react';
import { Terminal, ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalComponentProps {
  dispatch?: (action: { type: string; payload?: any; callback?: (res: any) => void }) => void;
  onKey?: (key: string) => void;
  props?: any;
}

const defaultTerminalOptions: ITerminalOptions = {
  scrollback: 50,
  disableStdin: false,
  cursorStyle: 'underline',
  cursorBlink: true,
  windowsMode: true,
  fontSize: 16,
  fontFamily: 'Courier New', // monospace
  theme: {
    foreground: '#ffffff',
    background: '#1a1a1d',
    cursor: 'help',
  },
};

const TerminalComponent: React.FC<TerminalComponentProps> = ({ dispatch, onKey }) => {
  const fitPlugin = useRef(new FitAddon());
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const terminalTitleTemplate = '[root@server] $ '; // 移除 ANSI 转义序列, 在writePrompt里设置颜色
  const historyLineData = useRef<string[]>([]);
  const currentLineData = useRef<string>('');
  const lastCommandIndex = useRef<number>(0);
  const isInitialized = useRef<boolean>(false);
  const renderCount = useRef<number>(0);
  const isDisposed = useRef<boolean>(false);

  const writePrompt = useCallback(() => {
    if (!isDisposed.current && termRef.current) {
      termRef.current.write('\r\n\x1B[97m' + terminalTitleTemplate + '\x1B[0m'); // 恢复默认颜色
    }
  }, [terminalTitleTemplate]);

  const runJob = useCallback(
    (param: string) => {
      if (param && dispatch && !isDisposed.current && termRef.current) {
        dispatch({
          type: 'task/terminalOperation',
          payload: { param },
          callback: (res: any) => {
            if (!isDisposed.current && termRef.current) {
              termRef.current.write(`\r\n`);
              if (res?.data?.taskListStr && Array.isArray(res.data.taskListStr)) {
                res.data.taskListStr.forEach((t: string) => {
                  termRef.current?.writeln(t);
                });
              } else if (res?.data?.errorData) {
                termRef.current?.writeln(res.data.errorData);
              }
              writePrompt();
              termRef.current.focus();
            }
          },
        });
      } else if (!isDisposed.current && termRef.current) {
        writePrompt();
      }
    },
    [dispatch]
  );

  useEffect(() => {
    const term = new Terminal(defaultTerminalOptions);
    termRef.current = term;
    isDisposed.current = false;
    let disposed = false;

    term.onData(async (key) => {
      // ... (onData 代码, 和之前一样) ...
      if (isDisposed.current || !termRef.current) {
        return;
      }

      const term = termRef.current; // 为了简化代码

      const writeKey = (k: string) => {
        if (!isDisposed.current && term) {
          term.write(k);
        }
      };

      const visiblePrompt = terminalTitleTemplate.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
      const promptLength = visiblePrompt.length;

      const writeBackspace = () => {
        if (!isDisposed.current && term && term.buffer.active.cursorX > promptLength) {
          currentLineData.current = currentLineData.current.slice(0, -1);
          writeKey('\b \b');
        }
      };

      // 清除当前行的辅助函数
      const clearCurrentLine = () => {
        if (!isDisposed.current && term) {
          // 将光标移动到提示符的起始位置
          term.write('\x1b[G'); // ANSI escape code: Cursor Horizontal Absolute (CHA)
          term.write(`\x1b[${promptLength + 1}G`);

          // 清除从光标位置到行尾的内容
          term.write('\x1b[K'); // ANSI escape code: Erase in Line (EL), K=0 (default)
        }
      }

      // Enter key
      if (key.charCodeAt(0) === 13) {
        const currentCommand = currentLineData.current.trim();
        if (currentCommand !== '') {
          historyLineData.current.push(currentCommand);
          lastCommandIndex.current = historyLineData.current.length;
        }

        if (currentCommand === 'clear') {
          if (!isDisposed.current && term) {
            term.clear();
          }
        }

        if (dispatch) {
          runJob(currentCommand);
        } else {
          writePrompt();
        }

        currentLineData.current = '';
      } else if (key.charCodeAt(0) === 127) {
        // Delete key
        writeBackspace();
      } else if (key === '\u001b[\x41') { // Up arrow
        if (historyLineData.current.length > 0 && lastCommandIndex.current > 0) {
          clearCurrentLine(); // 清除当前行
          lastCommandIndex.current--;
          currentLineData.current = historyLineData.current[lastCommandIndex.current % historyLineData.current.length] || '';
          writeKey(currentLineData.current);
        }
      } else if (key === '\u001b[\x42') { // Down arrow
        if (historyLineData.current.length > 0 && lastCommandIndex.current < historyLineData.current.length) {
          clearCurrentLine();  // 清除当前行
          lastCommandIndex.current++;  // 先++, 和Up Arrow保持一致
          currentLineData.current = historyLineData.current[(lastCommandIndex.current - 1) % historyLineData.current.length] || ''; // 减1是因为先++了
          writeKey(currentLineData.current);


          if (lastCommandIndex.current === historyLineData.current.length) {
            currentLineData.current = '';
            //if (!isDisposed.current && term) {  //这里不需要再次清除和writeKey，因为clearCurrentLine已经做了
            //    term.write('');
            //}
          }
        }
      } else {
        // Other characters
        currentLineData.current += key;
        writeKey(key);
      }

      if (onKey) {
        onKey(key);
      }
    });

    if (terminalRef.current) {
      term.open(terminalRef.current);
    }

    term.loadAddon(fitPlugin.current);
    fitPlugin.current.fit();
    window.onresize = () => fitPlugin.current.fit();
    term.focus();
    renderCount.current++;

    if (!isInitialized.current && dispatch) {
      dispatch({
        type: 'task/queryTask',
        callback: (res: any) => {
          if (!isDisposed.current && termRef.current) {
            if (res?.data?.taskList) {
              res.data.taskList.forEach((t: string) => {
                termRef.current?.writeln(t);
              });
            }
            isInitialized.current = true;  // 初始化完成后再设置为true
            writePrompt(); // 确保在回调中显示
          }
        },
      });
    } else {
      isInitialized.current = true; // 没有dispatch也设为true
    }
    writePrompt(); // 无论是否有dispatch, 最后都显示提示符

    return () => {
      isDisposed.current = true;
      if (termRef.current && !disposed) {
        termRef.current.dispose();
        termRef.current = null;
        disposed = true;
      }
    };
  }, [dispatch, onKey, writePrompt]);

  return (
    <div style={{
       width: '100vw', height: '100vh', margin: 0,
      padding: 0
    }}>
      <div style={{
          width: '100%',  // 宽度占满父元素 (虽然通常是默认行为，但明确写出更好)
          height: '100%', // 高度占满父元素
          // (可选) 添加一个背景色方便调试，看它是否真的充满了
          // backgroundColor:  "rgb(26, 26, 29)"
        }} ref={terminalRef}></div>
    </div>
  );
};

export default memo(TerminalComponent);