export class Notifier {
  constructor() {
    this.channels = new Map();
  }

  register(name, channel) {
    this.channels.set(name, channel);
  }

  async notify(task, text) {
    const channel = this.channels.get(task.channel);
    if (!channel?.sendMessage) return;
    await channel.sendMessage(task.chatId, text);
  }

  startTyping(task) {
    const channel = this.channels.get(task.channel);
    if (!channel?.startTyping) return () => {};
    return channel.startTyping(task.chatId);
  }
}
