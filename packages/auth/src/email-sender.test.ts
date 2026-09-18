import { describe, expect, it, vi } from 'vitest';
import { createResendEmailSender } from './email-sender.js';

const email = {
  to: 'person@example.com',
  subject: 'Test subject',
  text: 'Test body',
  html: '<p>Test body</p>',
};

describe('Resend email sender', () => {
  it('fails without provider configuration', async () => {
    const fetcher = vi.fn();
    await expect(
      createResendEmailSender({ apiKey: undefined, from: undefined, fetcher })(email),
    ).rejects.toThrow('email provider is not configured');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends the email through Resend without logging its contents', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    await createResendEmailSender({
      apiKey: 'test-api-key',
      from: 'CloudCrane <test@example.com>',
      fetcher,
    })(email);

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer test-api-key' }),
        body: JSON.stringify({
          from: 'CloudCrane <test@example.com>',
          to: ['person@example.com'],
          subject: 'Test subject',
          text: 'Test body',
          html: '<p>Test body</p>',
        }),
      }),
    );
  });

  it('returns a bounded provider error for a failed request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(
      createResendEmailSender({ apiKey: 'test-api-key', from: 'test@example.com', fetcher })(email),
    ).rejects.toThrow('email provider returned 401');
  });
});
