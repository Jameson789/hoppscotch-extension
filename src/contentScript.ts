import hookContent from "bundle-text:./hookContent.js"
import hookContentInvalidOrigin from "bundle-text:./hookContentInvalidOrigin.js"

declare global {
  interface Window {
    HOPP_CONTENT_SCRIPT_EXECUTED: boolean
  }
}

export type HOOK_MESSAGE = {
  type: "execute_hook"
  origin_type: "VALID_ORIGIN" | "UNKNOWN_ORIGIN"
}

function getOriginList(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get((items) => {
      let originList: string[] = JSON.parse(items["originList"])
      
      resolve(originList)
    })
  })
}

async function injectHoppExtensionHook() {
  let originList = await getOriginList()
  
  let url = new URL(window.location.href)
  const originType = originList.includes(url.origin)
    ? "VALID_ORIGIN"
    : "UNKNOWN_ORIGIN"

  if (process.env.HOPP_EXTENSION_TARGET === "FIREFOX") {
    const script = document.createElement("script")
    script.textContent = originList.includes(url.origin)
      ? hookContent
      : hookContentInvalidOrigin
    document.documentElement.appendChild(script)
    script.parentNode.removeChild(script)
  } else {
    chrome.runtime.sendMessage(<HOOK_MESSAGE>{
      type: "execute_hook",
      origin_type: originType,
    })
  }
}

function main() {
  // Check if the content script is already injected to avoid multiple injections side effects
  if (window.HOPP_CONTENT_SCRIPT_EXECUTED) {
    return
  }

  window.HOPP_CONTENT_SCRIPT_EXECUTED = true

  /**
   * When an origin is added or removed, reevaluate the hook
   */
  chrome.storage.onChanged.addListener((changes, _areaName) => {
    if (changes.originList && changes.originList.newValue) {
      injectHoppExtensionHook()
    }
  })

  window.addEventListener("message", async (ev) => {
    const originList = await getOriginList()
    let url = new URL(window.location.href)
    
    const originType = originList.includes(url.origin)
      ? "VALID_ORIGIN"
      : "UNKNOWN_ORIGIN"
    
    // Early return if not a valid source or origin
    if (ev.source !== window || !ev.data || originType != "VALID_ORIGIN") {
      return
    }
    
    if (ev.data.type === "__POSTWOMAN_EXTENSION_REQUEST__") {
      // Create a copy of the config to avoid modifying the original
      const config = { ...ev.data.config };
      
      try {
        chrome.runtime.sendMessage(
          {
            messageType: "send-req",
            data: config,
          },
          (message) => {
            if (message.data.error) {
              window.postMessage(
                {
                  type: "__POSTWOMAN_EXTENSION_ERROR__",
                  error: message.data.error,
                },
                "*"
              )
            } else {
              window.postMessage(
                {
                  type: "__POSTWOMAN_EXTENSION_RESPONSE__",
                  response: message.data.response,
                  isBinary: message.data.isBinary,
                },
                "*"
              )
            }
          }
        )
      } catch (error) {
        console.error("Message sending error:", error);
        window.postMessage(
          {
            type: "__POSTWOMAN_EXTENSION_ERROR__",
            error: {
              message: "Failed to send request",
              name: "TransferError",
              stack: error.stack
            },
          },
          "*"
        )
      }
    } else if (ev.data.type === "__POSTWOMAN_EXTENSION_CANCEL__") {
      chrome.runtime.sendMessage({
        messageType: "cancel-req",
      })
    }
  })

  injectHoppExtensionHook()

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "__POSTWOMAN_EXTENSION_PING__") {
      sendResponse(true)
    }
  })
}

main()