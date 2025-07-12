import { Message } from '@/lib/messages'
import { FragmentSchema } from '@/lib/schema'
import { ExecutionResult } from '@/lib/types'
import { DeepPartial } from 'ai'
import { LoaderIcon, Terminal, User } from 'lucide-react'
import { useEffect } from 'react'

export function Chat({
  messages,
  isLoading,
  setCurrentPreview,
}: {
  messages: Message[]
  isLoading: boolean
  setCurrentPreview: (preview: {
    fragment: DeepPartial<FragmentSchema> | undefined
    result: ExecutionResult | undefined
  }) => void
}) {
  useEffect(() => {
    const chatContainer = document.getElementById('chat-container')
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight
    }
  }, [JSON.stringify(messages)])

  return (
    <div
      id="chat-container"
      className="flex flex-col pb-12 gap-6 overflow-y-auto max-h-full"
    >
      {messages.map((message: Message, index: number) => (
        <div
          key={index}
          className={`flex gap-3 px-4 ${
            message.role === 'user' ? 'justify-end' : 'justify-start'
          }`}
        >
          {/* Avatar */}
          <div
            className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
              message.role === 'user'
                ? 'bg-primary text-primary-foreground order-2'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {message.role === 'user' ? (
              <User className="w-4 h-4" />
            ) : (
              <div className="w-4 h-4 bg-gradient-to-br from-blue-500 to-purple-600 rounded-sm" />
            )}
          </div>

          {/* Message Content */}
          <div
            className={`flex flex-col max-w-[80%] ${
              message.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            <div
              className={`px-4 py-3 rounded-2xl whitespace-pre-wrap font-serif ${
                message.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}
            >
              {message.content.map((content, id) => {
                if (content.type === 'text') {
                  return content.text
                }
                if (content.type === 'image') {
                  return (
                    <img
                      key={id}
                      src={content.image}
                      alt="fragment"
                      className="mr-2 inline-block w-12 h-12 object-cover rounded-lg bg-white mb-2"
                    />
                  )
                }
              })}
            </div>

            {/* Fragment Object */}
            {message.object && (
              <div
                onClick={() =>
                  setCurrentPreview({
                    fragment: message.object,
                    result: message.result,
                  })
                }
                className="mt-3 py-2 pl-2 w-full md:w-max flex items-center border rounded-xl select-none hover:bg-white dark:hover:bg-white/5 hover:cursor-pointer bg-background"
              >
                <div className="rounded-[0.5rem] w-10 h-10 bg-black/5 dark:bg-white/5 self-stretch flex items-center justify-center">
                  <Terminal strokeWidth={2} className="text-[#FF8800]" />
                </div>
                <div className="pl-2 pr-4 flex flex-col">
                  <span className="font-bold font-sans text-sm text-primary">
                    {message.object.title}
                  </span>
                  <span className="font-sans text-sm text-muted-foreground">
                    Click to see fragment
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
      
      {isLoading && (
        <div className="flex gap-3 px-4 justify-start">
          {/* AI Avatar */}
          <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-muted text-muted-foreground">
            <div className="w-4 h-4 bg-gradient-to-br from-blue-500 to-purple-600 rounded-sm" />
          </div>
          
          {/* Loading Message */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderIcon strokeWidth={2} className="animate-spin w-4 h-4" />
            <span>Generating...</span>
          </div>
        </div>
      )}
    </div>
  )
}
