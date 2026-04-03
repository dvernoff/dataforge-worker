let nodemailer: any = null;
function getNodemailer() {
  if (!nodemailer) { nodemailer = require('nodemailer'); }
  return nodemailer;
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from_address: string;
}

export class EmailSmtpPlugin {
  async sendEmail(
    config: SmtpConfig,
    to: string,
    subject: string,
    body: string,
    html?: string
  ) {
    const transporter = getNodemailer().createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: {
        user: config.user,
        pass: config.password,
      },
    });

    const result = await transporter.sendMail({
      from: config.from_address,
      to,
      subject,
      text: body,
      html: html ?? body,
    });

    return {
      messageId: result.messageId,
      accepted: result.accepted,
      rejected: result.rejected,
    };
  }
}
