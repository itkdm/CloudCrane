import type { InputHTMLAttributes } from 'react';
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`cc-input ${props.className ?? ''}`} />;
}
