import type { ImgHTMLAttributes } from 'react'
import owlIcon from '../assets/deepdesk-owl.png'

export default function DeepDeskLogo(props: ImgHTMLAttributes<HTMLImageElement>) {
  return <img src={owlIcon} alt='' aria-hidden='true' {...props} />
}
