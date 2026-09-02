import { useEffect, useState } from 'react'
import { Check, ChevronDown, Gauge, Pencil, RefreshCw, Search } from 'lucide-react'
import clsx from 'clsx'
import type { ModelConfig, ProviderConfig } from '@shared/types'
import DeepSeekLogo from '../DeepSeekLogo'
import zhipuIcon from '../../assets/icons/zhipu.svg'

interface AgentModelPickerProps {
  providers: ProviderConfig[]
  selectedProviderId: string
  selectedModelId: string
  auto: boolean
  maxMode: boolean
  open: boolean
  onToggle: () => void
  onSelect: (providerId: string, modelId: string) => void
  onAuto: () => void
  onMaxModeChange: (enabled: boolean) => void
  onConfigure: () => void
}

function matchesModel(provider: ProviderConfig, model: ModelConfig, terms: string[]): boolean {
  const text = [provider.name, provider.baseUrl, model.id, model.name].filter(Boolean).join(' ').toLowerCase()
  return terms.some(term => text.includes(term))
}

function ModelIcon({ provider, model, compact = false }: { provider: ProviderConfig; model: ModelConfig; compact?: boolean }) {
  if (matchesModel(provider, model, ['deepseek'])) {
    const size = compact ? 15 : 18
    return <DeepSeekLogo className='model-logo' width={size} height={size} aria-hidden />
  }
  if (matchesModel(provider, model, ['智谱', 'zhipu', 'bigmodel', 'glm'])) {
    return <img src={zhipuIcon} className={clsx('model-logo model-logo-img', compact && 'compact')} alt='' aria-hidden />
  }
  const label = (model.name ?? model.id).trim().charAt(0).toUpperCase()
  return <span className={clsx('model-mark', compact && 'compact')}>{label}</span>
}

export default function AgentModelPicker({
  providers,
  selectedProviderId,
  selectedModelId,
  auto,
  maxMode,
  open,
  onToggle,
  onSelect,
  onAuto,
  onMaxModeChange,
  onConfigure
}: AgentModelPickerProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const configuredProviders = providers.filter(provider => provider.apiKey.trim() && provider.models.length > 0)
  const term = query.trim().toLocaleLowerCase()
  const visibleProviders = configuredProviders
    .map(provider => ({ provider, models: term ? provider.models.filter(model => matchesModel(provider, model, [term])) : provider.models }))
    .filter(group => group.models.length > 0)
  const selectableModels = visibleProviders.flatMap(({ provider, models }) => models.map(model => ({ provider, model })))
  const selectedProvider = providers.find(provider => provider.id === selectedProviderId)
  const selectedModel = selectedProvider?.models.find(model => model.id === selectedModelId)
  const selectedLabel = (selectedModel?.name ?? selectedModelId) || '选择模型'

  useEffect(() => {
    if (open) setActiveIndex(0)
  }, [open, query])

  const chooseActive = (): void => {
    if (activeIndex === 0) onAuto()
    else {
      const selected = selectableModels[activeIndex - 1]
      if (selected) onSelect(selected.provider.id, selected.model.id)
    }
  }

  return (
    <div className='composer-menu'>
      <button className='toolbar-item composer-menu-trigger composer-model-trigger' aria-expanded={open} onClick={onToggle} title='选择模型'>
        {auto || !selectedProvider || !selectedModel
          ? <RefreshCw size={14} />
          : <ModelIcon provider={selectedProvider} model={selectedModel} compact />}
        <span>{auto ? 'Auto' : selectedLabel}</span><ChevronDown size={12} />
      </button>
      {open && (
        <div className='composer-menu-popover composer-model-popover' role='menu' aria-label='选择模型'>
          <div className='model-menu-header'>
            <div className='model-menu-title'><Gauge size={15} /> Max 模式</div>
            <button type='button' className={clsx('model-max-switch', maxMode && 'on')} role='switch' aria-checked={maxMode} aria-label='Max 模式' title='为复杂任务提供更长输出预算' onClick={() => onMaxModeChange(!maxMode)}>
              <span />
            </button>
          </div>
          <label className='model-menu-search'>
            <Search size={14} aria-hidden />
            <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder='搜索模型' aria-label='搜索模型' onKeyDown={event => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex(index => Math.min(selectableModels.length, index + 1)) }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(index => Math.max(0, index - 1)) }
              else if (event.key === 'Enter') { event.preventDefault(); chooseActive() }
              else if (event.key === 'Escape') { event.preventDefault(); onToggle() }
            }} />
          </label>
          <button className={clsx('model-menu-option auto', activeIndex === 0 && 'keyboard-active')} role='menuitemradio' aria-checked={auto} onPointerMove={() => setActiveIndex(0)} onClick={onAuto}>
            <span className='model-option-main'><RefreshCw size={16} /><span>Auto</span></span>
            {auto && <Check size={15} />}
          </button>
          <div className='model-menu-list'>
            {visibleProviders.map(({ provider, models }) => (
              <section className='model-provider-group' aria-label={provider.name} key={provider.id}>
                <div className='model-provider-heading'>
                  <span>{provider.name}</span>
                  <span>{models.length}</span>
                </div>
                {models.map(model => {
                  const selected = !auto && provider.id === selectedProviderId && model.id === selectedModelId
                  const optionIndex = selectableModels.findIndex(option => option.provider.id === provider.id && option.model.id === model.id) + 1
                  return (
                    <button key={`${provider.id}:${model.id}`} className={clsx('model-menu-option', activeIndex === optionIndex && 'keyboard-active')} role='menuitemradio' aria-checked={selected} onPointerMove={() => setActiveIndex(optionIndex)} onClick={() => onSelect(provider.id, model.id)}>
                      <span className='model-option-main'>
                        <ModelIcon provider={provider} model={model} />
                        <span className='model-name'>{model.name ?? model.id}</span>
                      </span>
                      {selected && <span className='model-check'><Check size={15} /></span>}
                    </button>
                  )
                })}
              </section>
            ))}
            {configuredProviders.length === 0 && <div className='model-menu-empty'>还没有已配置的模型服务</div>}
            {configuredProviders.length > 0 && visibleProviders.length === 0 && <div className='model-menu-empty'>未找到匹配模型</div>}
          </div>
          <button className='model-menu-config' role='menuitem' onClick={onConfigure}>
            <Pencil size={15} />
            <span>配置模型服务</span>
          </button>
        </div>
      )}
    </div>
  )
}
