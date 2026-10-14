import type { EngineInterface } from 'claude-code'

// Puts rich text on the system clipboard. `$.ui.copy` writes plain text
// only, so this runs the platform's own clipboard tool:
// - macOS: osascript (JXA) writes HTML, RTF and plain text in one item,
//   and each app pastes the richest type it reads.
// - Linux: wl-copy (Wayland) or xclip (X11), as text/html.
// - Windows: PowerShell's Set-Clipboard -AsHtml.

export type RichCopy = { isCopied: true } | { isCopied: false; reason: string }

type Platform = 'mac' | 'linux' | 'windows'

const MAC_SCRIPT = `
ObjC.import('AppKit');
function run() {
  var input = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  var draft = JSON.parse($.NSString.alloc.initWithDataEncoding(input, $.NSUTF8StringEncoding).js);
  var html = $(draft.html);
  var board = $.NSPasteboard.generalPasteboard;
  board.clearContents;
  var rich = $.NSAttributedString.alloc.initWithHTMLDocumentAttributes(html.dataUsingEncoding($.NSUTF8StringEncoding), null);
  if (rich && !rich.isNil()) {
    var rtf = rich.RTFFromRangeDocumentAttributes($.NSMakeRange(0, rich.length), $.NSDictionary.dictionary);
    if (rtf && !rtf.isNil()) board.setDataForType(rtf, $.NSPasteboardTypeRTF);
  }
  board.setStringForType(html, $.NSPasteboardTypeHTML);
  board.setStringForType($(draft.plain), $.NSPasteboardTypeString);
  return 'ok';
}
`

const WINDOWS_SCRIPT =
  '[Console]::InputEncoding = [Text.Encoding]::UTF8; ' +
  '$html = [Console]::In.ReadToEnd(); ' +
  'Set-Clipboard -Value $html -AsHtml'

let platform: Platform | undefined

async function detect($: EngineInterface): Promise<Platform> {
  if (platform) {
    return platform
  }
  if ((await $.env.get('OS')) === 'Windows_NT') {
    platform = 'windows'

    return platform
  }
  try {
    const { stdout } = await $.process.run(['uname', '-s'], { timeoutMs: 5000 })
    platform = stdout.trim() === 'Darwin' ? 'mac' : 'linux'
  } catch {
    platform = 'windows'
  }

  return platform
}

function failed(stderr: string, fallback: string): RichCopy {
  return { isCopied: false, reason: stderr.trim().split('\n')[0] || fallback }
}

export async function copyRich($: EngineInterface, html: string, plain: string): Promise<RichCopy> {
  try {
    switch (await detect($)) {
      case 'mac': {
        const ran = await $.process.run(['osascript', '-l', 'JavaScript', '-e', MAC_SCRIPT], {
          stdin: JSON.stringify({ html, plain }),
          timeoutMs: 15000,
        })

        return ran.exitCode === 0 ? { isCopied: true } : failed(ran.stderr, 'osascript failed')
      }
      case 'linux': {
        // Both tools fork a child that keeps serving the clipboard. Its
        // output goes to /dev/null, so the call does not wait for it.
        const tool = (await $.env.get('WAYLAND_DISPLAY'))
          ? 'wl-copy --type text/html'
          : 'xclip -selection clipboard -t text/html -i'
        const ran = await $.process.run(['sh', '-c', `${tool} >/dev/null 2>&1`], { stdin: html, timeoutMs: 15000 })

        return ran.exitCode === 0 ? { isCopied: true } : failed(ran.stderr, 'install wl-clipboard or xclip')
      }
      case 'windows': {
        const ran = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT], {
          stdin: html,
          timeoutMs: 15000,
        })

        return ran.exitCode === 0 ? { isCopied: true } : failed(ran.stderr, 'PowerShell failed')
      }
    }
  } catch (error) {
    return { isCopied: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
