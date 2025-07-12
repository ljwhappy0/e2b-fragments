'use client'

import { ViewType } from '@/components/auth'
import { AuthDialog } from '@/components/auth-dialog'
import { Chat } from '@/components/chat'
import { ChatInput } from '@/components/chat-input'
import { ChatPicker } from '@/components/chat-picker'
import { ChatSettings } from '@/components/chat-settings'
import { NavBar } from '@/components/navbar'
import { Preview } from '@/components/preview'
import { useAuth } from '@/lib/auth'
import { Message, toAISDKMessages, toMessageImage } from '@/lib/messages'
import { LLMModelConfig } from '@/lib/models'
import modelsList from '@/lib/models.json'
import { FragmentSchema, fragmentSchema as schema } from '@/lib/schema'
import { supabase } from '@/lib/supabase'
import templates, { TemplateId } from '@/lib/templates'
import { ExecutionResult } from '@/lib/types'
import { DeepPartial } from 'ai'
import { experimental_useObject as useObject, useChat } from 'ai/react'
import { usePostHog } from 'posthog-js/react'
import { SetStateAction, useEffect, useState } from 'react'
import { useLocalStorage } from 'usehooks-ts'

export default function Home() {
  const [chatInput, setChatInput] = useLocalStorage('chat', '')
  const [files, setFiles] = useState<File[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<'auto' | TemplateId>(
    'auto',
  )
  const [languageModel, setLanguageModel] = useLocalStorage<LLMModelConfig>(
    'languageModel',
    {
      model: 'claude-3-5-sonnet-latest',
    },
  )

  const posthog = usePostHog()

  const [result, setResult] = useState<ExecutionResult>()
  const [messages, setMessages] = useState<Message[]>([])
  const [fragment, setFragment] = useState<DeepPartial<FragmentSchema>>()
  const [currentTab, setCurrentTab] = useState<'code' | 'fragment'>('code')
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [isAuthDialogOpen, setAuthDialog] = useState(false)
  const [authView, setAuthView] = useState<ViewType>('sign_in')
  const [isRateLimited, setIsRateLimited] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [hasInitializedPM, setHasInitializedPM] = useState(false)
  const [isPMDone, setIsPMDone] = useState(false)
  const { session, userTeam } = useAuth(setAuthDialog, setAuthView)

  const filteredModels = modelsList.models.filter((model) => {
    if (process.env.NEXT_PUBLIC_HIDE_LOCAL_MODELS) {
      return model.providerId !== 'ollama'
    }
    return true
  })

  const currentModel = filteredModels.find(
    (model) => model.id === languageModel.model,
  )
  const currentTemplate =
    selectedTemplate === 'auto'
      ? templates
      : { [selectedTemplate]: templates[selectedTemplate] }
  const lastMessage = messages[messages.length - 1]

  // 判断是否为PM模板
  const isPMTemplate = selectedTemplate === 'PM'
  console.log('Template state:', { selectedTemplate, isPMTemplate, hasInitializedPM })

  // PM模板的纯聊天功能
  const { messages: pmMessages, input: pmInput, handleInputChange: pmHandleInputChange, handleSubmit: pmHandleSubmit, isLoading: pmIsLoading, stop: pmStop, error: pmError } = useChat({
    api: '/api/pm-chat',
    streamProtocol: 'text',
    experimental_prepareRequestBody: ({ messages }) => {
      const body: any = {
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        template: currentTemplate,
        model: currentModel,
        config: languageModel,
      }
      
      if (session?.user?.id) body.userID = session.user.id
      if (userTeam?.id) body.teamID = userTeam.id
      
      return body
    },
    onError: (error) => {
      console.error('Error submitting PM request:', error)
      if (error.message.includes('limit')) {
        setIsRateLimited(true)
      }
      setErrorMessage(error.message)
    },
    onFinish: (message) => {
      console.log('PM chat finished:', message)
      posthog.capture('pm_chat_finished', {
        template: 'PM',
      })
    },
  })

  // 其他模板的结构化生成功能
  const { object, submit, isLoading, stop, error } = useObject({
    api: '/api/chat',
    schema,
    onError: (error) => {
      console.error('Error submitting request:', error)
      if (error.message.includes('limit')) {
        setIsRateLimited(true)
      }

      setErrorMessage(error.message)
    },
    onFinish: async ({ object: fragment, error }) => {
      if (!error) {
        console.log('fragment', fragment)
        setIsPreviewLoading(true)
        posthog.capture('fragment_generated', {
          template: fragment?.template,
        })

        const response = await fetch('/api/sandbox', {
          method: 'POST',
          body: JSON.stringify({
            fragment,
            userID: session?.user?.id,
            teamID: userTeam?.id,
            accessToken: session?.access_token,
          }),
        })

        const result = await response.json()
        console.log('result', result)
        posthog.capture('sandbox_created', { url: result.url })

        setResult(result)
        setCurrentPreview({ fragment, result })
        setMessage({ result })
        setCurrentTab('fragment')
        setIsPreviewLoading(false)
      }
    },
  })

  useEffect(() => {
    if (object) {
      setFragment(object)
      const content: Message['content'] = [
        { type: 'text', text: object.commentary || '' },
        { type: 'code', text: object.code || '' },
      ]

      if (!lastMessage || lastMessage.role !== 'assistant') {
        addMessage({
          role: 'assistant',
          content,
          object,
        })
      }

      if (lastMessage && lastMessage.role === 'assistant') {
        setMessage({
          content,
          object,
        })
      }
    }
  }, [object])

  useEffect(() => {
    if (error) stop()
  }, [error])

  useEffect(() => {
    if (pmError) {
      console.error('PM chat error:', pmError)
      if (pmError.message.includes('limit')) {
        setIsRateLimited(true)
      }
      setErrorMessage(pmError.message)
    }
  }, [pmError])

  // 检测PM模板是否完成
  useEffect(() => {
    if (isPMTemplate && pmMessages.length > 0) {
      const lastMessage = pmMessages[pmMessages.length - 1]
      if (lastMessage.role === 'assistant' && lastMessage.content.includes('<!-- PM-DONE -->')) {
        setIsPMDone(true)
      }
    } else {
      setIsPMDone(false)
    }
  }, [pmMessages, isPMTemplate])

  // 当切换到PM模板时，自动发送初始消息
  useEffect(() => {
    console.log('useEffect triggered:', { isPMTemplate, hasInitializedPM, session: !!session })
    if (isPMTemplate && !hasInitializedPM && session) {
      console.log('Attempting to initialize PM template...')
      
      // 使用useChat的handleSubmit来发送消息，这样响应会显示在聊天界面
      const mockEvent = {
        preventDefault: () => {},
        currentTarget: {
          checkValidity: () => true,
          reportValidity: () => {}
        }
      } as any
      
      // 设置输入内容并提交
      pmHandleInputChange({ target: { value: '你好' } } as any)
      setTimeout(() => {
        pmHandleSubmit(mockEvent)
        setHasInitializedPM(true)
        console.log('PM template initialized with initial message')
      }, 100)
    }
  }, [isPMTemplate, hasInitializedPM, session, pmHandleSubmit, pmHandleInputChange])

  function setMessage(message: Partial<Message>, index?: number) {
    setMessages((previousMessages) => {
      const updatedMessages = [...previousMessages]
      updatedMessages[index ?? previousMessages.length - 1] = {
        ...previousMessages[index ?? previousMessages.length - 1],
        ...message,
      }

      return updatedMessages
    })
  }

  async function handleSubmitAuth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!session) {
      return setAuthDialog(true)
    }

    // 根据模板类型选择不同的处理方式
    if (isPMTemplate) {
      // PM模板使用纯聊天
      if (pmIsLoading) {
        pmStop()
      }
      
      // 直接使用PM聊天的handleSubmit
      pmHandleSubmit(e)
      
      posthog.capture('chat_submit', {
        template: 'PM',
        model: languageModel.model,
      })
    } else {
      // 其他模板使用结构化生成
      if (isLoading) {
        stop()
      }

      const content: Message['content'] = [{ type: 'text', text: chatInput }]
      const images = await toMessageImage(files)

      if (images.length > 0) {
        images.forEach((image) => {
          content.push({ type: 'image', image })
        })
      }

      const updatedMessages = addMessage({
        role: 'user',
        content,
      })

      submit({
        userID: session?.user?.id,
        teamID: userTeam?.id,
        messages: toAISDKMessages(updatedMessages),
        template: currentTemplate,
        model: currentModel,
        config: languageModel,
      })

      setChatInput('')
      setFiles([])
      setCurrentTab('code')

      posthog.capture('chat_submit', {
        template: selectedTemplate,
        model: languageModel.model,
      })
    }
  }

  function retry() {
    if (isPMTemplate) {
      // PM模板重试逻辑
      pmHandleSubmit(new Event('submit') as any)
    } else {
      // 其他模板重试逻辑
      submit({
        userID: session?.user?.id,
        teamID: userTeam?.id,
        messages: toAISDKMessages(messages),
        template: currentTemplate,
        model: currentModel,
        config: languageModel,
      })
    }
  }

  // 生成原型处理函数
  function handleGeneratePrototype() {
    if (!session) {
      return setAuthDialog(true)
    }

    // 切换到HTML+TailwindCSS模板
    setSelectedTemplate('HTML+TailwindCSS')
    
    // 准备产品设计说明
    const productSpec = pmMessages
      .filter(msg => msg.role === 'assistant')
      .map(msg => msg.content)
      .join('\n\n')
    
    // 使用结构化生成API
    submit({
      userID: session?.user?.id,
      teamID: userTeam?.id,
      messages: [{
        role: 'user',
        content: `请根据以下产品设计文档生成一个HTML原型页面：\n\n${productSpec}`
      }],
      template: { 'HTML+TailwindCSS': templates['HTML+TailwindCSS'] },
      model: currentModel,
      config: languageModel,
    })

    setChatInput('')
    setFiles([])
    setCurrentTab('code')

    posthog.capture('prototype_generated', {
      template: 'HTML+TailwindCSS',
      model: languageModel.model,
    })
  }

  function addMessage(message: Message) {
    setMessages((previousMessages) => [...previousMessages, message])
    return [...messages, message]
  }

  function handleSaveInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setChatInput(e.target.value)
  }

  function handleFileChange(change: SetStateAction<File[]>) {
    setFiles(change)
  }

  function logout() {
    supabase
      ? supabase.auth.signOut()
      : console.warn('Supabase is not initialized')
  }

  function handleLanguageModelChange(e: LLMModelConfig) {
    setLanguageModel({ ...languageModel, ...e })
  }

  function handleSocialClick(target: 'github' | 'x' | 'discord') {
    if (target === 'github') {
      window.open('https://github.com/e2b-dev/fragments', '_blank')
    } else if (target === 'x') {
      window.open('https://x.com/e2b_dev', '_blank')
    } else if (target === 'discord') {
      window.open('https://discord.gg/U7KEcGErtQ', '_blank')
    }

    posthog.capture(`${target}_click`)
  }

  function handleClearChat() {
    if (isPMTemplate) {
      // PM模板清除聊天
      pmStop()
      setChatInput('')
      setFiles([])
      setMessages([])
      setFragment(undefined)
      setResult(undefined)
      setCurrentTab('code')
      setIsPreviewLoading(false)
      setHasInitializedPM(false) // 重置PM初始化状态
    } else {
      // 其他模板清除聊天
      stop()
      setChatInput('')
      setFiles([])
      setMessages([])
      setFragment(undefined)
      setResult(undefined)
      setCurrentTab('code')
      setIsPreviewLoading(false)
    }
  }

  function setCurrentPreview(preview: {
    fragment: DeepPartial<FragmentSchema> | undefined
    result: ExecutionResult | undefined
  }) {
    setFragment(preview.fragment)
    setResult(preview.result)
  }

  function handleUndo() {
    setMessages((previousMessages) => [...previousMessages.slice(0, -2)])
    setCurrentPreview({ fragment: undefined, result: undefined })
  }

  return (
    <main className="flex min-h-screen max-h-screen">
      {supabase && (
        <AuthDialog
          open={isAuthDialogOpen}
          setOpen={setAuthDialog}
          view={authView}
          supabase={supabase}
        />
      )}
      <div className="grid w-full md:grid-cols-2">
        <div
          className={`flex flex-col w-full max-h-full max-w-[800px] mx-auto px-4 overflow-auto ${fragment ? 'col-span-1' : 'col-span-2'}`}
        >
          <NavBar
            session={session}
            showLogin={() => setAuthDialog(true)}
            signOut={logout}
            onSocialClick={handleSocialClick}
            onClear={handleClearChat}
            canClear={messages.length > 0}
            canUndo={messages.length > 1 && !isLoading}
            onUndo={handleUndo}
          />
                  <Chat
          messages={isPMTemplate ? pmMessages
            .filter(msg => msg.role === 'user' || msg.role === 'assistant')
            .map(msg => ({
              role: msg.role as 'user' | 'assistant',
              content: [{ type: 'text' as const, text: msg.content }],
            })) : messages}
          isLoading={isLoading || pmIsLoading}
          setCurrentPreview={setCurrentPreview}
        />
          <ChatInput
            retry={retry}
            isErrored={error !== undefined || pmError !== undefined}
            errorMessage={errorMessage}
            isLoading={isLoading || pmIsLoading}
            isRateLimited={isRateLimited}
            stop={isPMTemplate ? pmStop : stop}
            input={isPMTemplate ? pmInput : chatInput}
            handleInputChange={isPMTemplate ? pmHandleInputChange : handleSaveInputChange}
            handleSubmit={handleSubmitAuth}
            isMultiModal={currentModel?.multiModal || false}
            files={files}
            handleFileChange={handleFileChange}
            showPrototypeButton={isPMTemplate && isPMDone}
            onGeneratePrototype={handleGeneratePrototype}
          >
            <ChatPicker
              templates={templates}
              selectedTemplate={selectedTemplate}
              onSelectedTemplateChange={setSelectedTemplate}
              models={filteredModels}
              languageModel={languageModel}
              onLanguageModelChange={handleLanguageModelChange}
            />
            <ChatSettings
              languageModel={languageModel}
              onLanguageModelChange={handleLanguageModelChange}
              apiKeyConfigurable={!process.env.NEXT_PUBLIC_NO_API_KEY_INPUT}
              baseURLConfigurable={!process.env.NEXT_PUBLIC_NO_BASE_URL_INPUT}
            />
          </ChatInput>
        </div>
        <Preview
          teamID={userTeam?.id}
          accessToken={session?.access_token}
          selectedTab={currentTab}
          onSelectedTabChange={setCurrentTab}
          isChatLoading={isLoading}
          isPreviewLoading={isPreviewLoading}
          fragment={fragment}
          result={result as ExecutionResult}
          onClose={() => setFragment(undefined)}
        />
      </div>
    </main>
  )
}
