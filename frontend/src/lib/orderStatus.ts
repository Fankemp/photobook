import type { OrderStatus } from '../types.ts'

// Окно правок после заявки (как orders.Editable на сервере): пока заказ в этих
// статусах, клиент может менять книгу по своей ссылке. С «printing» и дальше
// книга в печати — только просмотр.
export const EDITABLE_STATUSES: OrderStatus[] = ['new', 'awaiting_prepayment', 'paid']
const LOCKED_STATUSES: OrderStatus[] = ['printing', 'delivery', 'done']

export const bookLocked = (order: { status: OrderStatus } | null | undefined) => !!order && LOCKED_STATUSES.includes(order.status)
