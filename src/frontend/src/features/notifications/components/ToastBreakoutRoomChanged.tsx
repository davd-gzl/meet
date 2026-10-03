import { useToast } from 'react-aria'
import { useRef } from 'react'

import { type ToastProps } from './Toast'
import { HStack } from '@/styled-system/jsx'
import { useTranslation } from 'react-i18next'
import { StyledToastContainer } from './StyledToastContainer'

// The room this browser just moved to, the main room, or the rooms closing.
export function ToastBreakoutRoomChanged({
  state,
  ...props
}: Readonly<ToastProps>) {
  const { t } = useTranslation('notifications', { keyPrefix: 'breakout' })
  const ref = useRef(null)
  const { toastProps, contentProps } = useToast(props, state, ref)
  const room: string | null = props.toast.content.room
  let message = t('closed')
  if (room) message = t('moved', { room })
  else if (props.toast.content.isOpen) message = t('main')

  return (
    <StyledToastContainer {...toastProps} ref={ref}>
      <HStack
        justify="center"
        alignItems="center"
        {...contentProps}
        padding={14}
        gap={0}
      >
        {message}
      </HStack>
    </StyledToastContainer>
  )
}
