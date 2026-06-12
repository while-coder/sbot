/**
 * 投递模式：消息进到 session 后做什么。
 * agenda trigger / heartbeat / 后续其他"定时投递"机制都共用这一套。
 *
 * - Notify: 仅投递文本到 channel（IM/webhook 等），不写 saver、不让 AI 处理。
 *   一次性提醒/外发通知；用户响应不依赖这次投递的上下文。
 * - NotifyAndRecord: 投递 + 把文本以 AI 角色 + Normal kind 写入 saver。
 *   主对话 agent 后续能看到"系统刚提醒了用户"，避免上下文断裂。
 *   适合 occurrence 打卡/汇报类 routine。
 * - Invoke: 把文本当作"用户输入"投给 AI 处理，让 agent 主动响应。
 *   需要 AI 在触发瞬间产出内容时使用（如自动总结日志）。
 */
export enum SessionDeliveryMode {
    Notify = 'notify',
    NotifyAndRecord = 'notify_and_record',
    Invoke = 'invoke',
}
