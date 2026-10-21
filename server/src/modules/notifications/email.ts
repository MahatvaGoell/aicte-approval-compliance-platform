import fs from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';
import type { AppConfig } from '../../config.js';

// Email delivery behind one interface. The demo uses the outbox adapter, which writes .eml files and
// never sends anything. "Accepted" means the adapter took the message; it is not proof of delivery.

export interface EmailMessage {
  /** Stable id for this notification. Re-sending the same id must not create a second message. */
  messageId: string;
  to: string;
  subject: string;
  text: string;
}

export interface SendResult {
  outcome: 'ACCEPTED';
  providerRef: string;
  duplicate: boolean;
}

export class EmailDeliveryError extends Error {
  constructor(message: string, public permanent: boolean) {
    super(message);
  }
}

export interface EmailAdapter {
  readonly name: string;
  readonly simulated: boolean;
  send(msg: EmailMessage, attemptNo: number): Promise<SendResult>;
}

const ADDRESS_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const SAFE_ID_RE = /^[A-Za-z0-9._-]{1,120}$/;

function validate(msg: EmailMessage) {
  if (!ADDRESS_RE.test(msg.to)) throw new EmailDeliveryError(`Invalid recipient address`, true);
  if (!SAFE_ID_RE.test(msg.messageId)) throw new EmailDeliveryError('Invalid message id', true);
  // Header injection guard: subjects are single-line.
  if (/[\r\n]/.test(msg.subject)) throw new EmailDeliveryError('Subject must be a single line', true);
}

function domainOf(address: string) {
  return address.split('@')[1]?.toLowerCase() ?? '';
}

export interface OutboxOptions {
  dir: string;
  from: string;
  transientFailureDomains?: string[];
  permanentFailureDomains?: string[];
  /** For transient-failure domains: attempts that fail before one succeeds. */
  transientFailuresBeforeSuccess?: number;
}

/**
 * Writes each message to `<dir>/<messageId>.eml`. Sending the same messageId again returns the existing
 * file as a duplicate, which models provider-side idempotency. Configured domains simulate failures.
 */
export class OutboxEmailAdapter implements EmailAdapter {
  readonly name = 'outbox';
  readonly simulated = true;
  constructor(private opts: OutboxOptions) {}

  async send(msg: EmailMessage, attemptNo: number): Promise<SendResult> {
    validate(msg);
    const domain = domainOf(msg.to);
    if (this.opts.permanentFailureDomains?.includes(domain)) {
      throw new EmailDeliveryError(`Simulated permanent failure: mailbox at ${domain} does not exist`, true);
    }
    if (this.opts.transientFailureDomains?.includes(domain) && attemptNo <= (this.opts.transientFailuresBeforeSuccess ?? 2)) {
      throw new EmailDeliveryError(`Simulated temporary failure: ${domain} did not respond (attempt ${attemptNo})`, false);
    }
    await fs.mkdir(this.opts.dir, { recursive: true });
    const file = path.join(this.opts.dir, `${msg.messageId}.eml`);
    const body = [
      `Message-ID: <${msg.messageId}@outbox.demo>`,
      `Date: ${new Date().toUTCString()}`,
      `From: ${this.opts.from}`,
      `To: ${msg.to}`,
      `Subject: ${msg.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'X-Demo-Outbox: not delivered; written locally for demonstration',
      '',
      msg.text,
      '',
    ].join('\r\n');
    try {
      // 'wx' fails if the file exists, so concurrent duplicates cannot both write.
      await fs.writeFile(file, body, { encoding: 'utf8', flag: 'wx' });
      return { outcome: 'ACCEPTED', providerRef: path.basename(file), duplicate: false };
    } catch (err: any) {
      if (err?.code === 'EEXIST') return { outcome: 'ACCEPTED', providerRef: path.basename(file), duplicate: true };
      throw new EmailDeliveryError(`Could not write to the outbox: ${err?.message ?? err}`, false);
    }
  }

  /** Lists messages for the outbox preview screen, newest first. */
  async list(limit = 50) {
    try {
      const files = (await fs.readdir(this.opts.dir)).filter((f) => f.endsWith('.eml'));
      const stats = await Promise.all(files.map(async (f) => ({ f, t: (await fs.stat(path.join(this.opts.dir, f))).mtimeMs })));
      return stats.sort((a, b) => b.t - a.t).slice(0, limit).map((s) => s.f);
    } catch (err: any) {
      if (err?.code === 'ENOENT') return [];
      throw err;
    }
  }

  async read(fileName: string) {
    if (!/^[A-Za-z0-9._-]+\.eml$/.test(fileName)) throw new Error('Invalid outbox file name');
    return fs.readFile(path.join(this.opts.dir, fileName), 'utf8');
  }
}

/** Real delivery through SMTP. Uses the message id as the Message-ID header so providers can deduplicate. */
export class SmtpEmailAdapter implements EmailAdapter {
  readonly name = 'smtp';
  readonly simulated = false;
  private transport: nodemailer.Transporter;
  constructor(url: string, private from: string) {
    this.transport = nodemailer.createTransport(url);
  }

  async send(msg: EmailMessage): Promise<SendResult> {
    validate(msg);
    try {
      const info = await this.transport.sendMail({
        from: this.from, to: msg.to, subject: msg.subject, text: msg.text, messageId: `<${msg.messageId}@aicte-platform>`,
      });
      return { outcome: 'ACCEPTED', providerRef: String(info.messageId ?? msg.messageId), duplicate: false };
    } catch (err: any) {
      // SMTP 5xx replies are permanent; everything else (timeouts, 4xx) is worth retrying.
      const code = Number(err?.responseCode ?? 0);
      throw new EmailDeliveryError(err?.message ?? 'SMTP send failed', code >= 500 && code < 600);
    }
  }
}

export function createEmailAdapter(config: AppConfig): EmailAdapter {
  if (config.emailAdapter === 'smtp') {
    if (!config.smtpUrl) throw new Error('EMAIL_ADAPTER=smtp requires SMTP_URL');
    return new SmtpEmailAdapter(config.smtpUrl, config.emailFrom);
  }
  return new OutboxEmailAdapter({
    dir: config.outboxDir,
    from: config.emailFrom,
    transientFailureDomains: config.transientFailureDomains,
    permanentFailureDomains: config.permanentFailureDomains,
  });
}

/** Retry delay after a failed attempt: exponential with a cap (1m, 2m, 4m, ... up to 1h). */
export function retryDelayMs(attemptNo: number): number {
  return Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attemptNo - 1));
}
