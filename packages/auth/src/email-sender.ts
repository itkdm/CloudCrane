export type AuthEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

type ResendEmailSenderOptions = {
  apiKey: string | undefined;
  from: string | undefined;
  fetcher?: typeof fetch;
};

export function createResendEmailSender({
  apiKey,
  from,
  fetcher = fetch,
}: ResendEmailSenderOptions) {
  return async (email: AuthEmail): Promise<void> => {
    if (!apiKey || !from) throw new Error('email provider is not configured');

    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });

    if (!response.ok) throw new Error(`email provider returned ${response.status}`);
  };
}
