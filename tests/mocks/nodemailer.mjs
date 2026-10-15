export const transports = [];
export const sent = [];

const defaultSend = async () => ({ messageId: "<test-message@example.test>" });
let sendImpl = defaultSend;

export function setSendMail(fn) {
  sendImpl = fn;
}

export function resetMailer() {
  transports.length = 0;
  sent.length = 0;
  sendImpl = defaultSend;
}

function createTransport(options) {
  transports.push(options);
  return {
    async sendMail(message) {
      sent.push(message);
      return sendImpl(message);
    },
  };
}

const nodemailer = { createTransport };

export default nodemailer;
