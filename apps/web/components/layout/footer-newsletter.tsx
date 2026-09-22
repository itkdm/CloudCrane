'use client';

import { Send } from 'lucide-react';
import { FormEvent, useState } from 'react';

export function FooterNewsletter({
  label,
  description,
  placeholder,
  submitLabel,
  successMessage,
}: {
  label: string;
  description: string;
  placeholder: string;
  submitLabel: string;
  successMessage: string;
}) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    setSubmitted(true);
  }

  return (
    <div className="marketing-footer-newsletter">
      <h2>{label}</h2>
      <p>{description}</p>
      <form className="marketing-footer-subscribe" onSubmit={submit}>
        <label className="sr-only" htmlFor="footer-email">
          {placeholder}
        </label>
        <input
          id="footer-email"
          type="email"
          value={email}
          placeholder={placeholder}
          onChange={(event) => {
            setEmail(event.target.value);
            setSubmitted(false);
          }}
          required
        />
        <button type="submit" aria-label={submitLabel} title={submitLabel}>
          <Send size={16} aria-hidden="true" />
        </button>
      </form>
      {submitted ? (
        <p className="marketing-footer-subscribe-success" role="status">
          {successMessage}
        </p>
      ) : null}
    </div>
  );
}
