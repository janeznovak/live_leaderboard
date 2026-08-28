import { EventEmitter } from 'node:events'

const reviewQueueEvents = new EventEmitter()

export function notifyReviewQueueChanged() {
  reviewQueueEvents.emit('changed')
}

export function onReviewQueueChanged(listener: () => void) {
  reviewQueueEvents.on('changed', listener)
  return () => reviewQueueEvents.off('changed', listener)
}
