import { EventEmitter } from 'node:events';
import type { JobOffer, JobResult } from './types.js';

interface JobBoardEvents {
  job: [offer: JobOffer];
  jobComplete: [result: JobResult];
}

class JobBoard extends EventEmitter {
  emit<E extends keyof JobBoardEvents>(event: E, ...args: JobBoardEvents[E]): boolean {
    return super.emit(event, ...args);
  }

  on<E extends keyof JobBoardEvents>(event: E, listener: (...args: JobBoardEvents[E]) => void): this {
    return super.on(event, listener);
  }

  postJob(offer: JobOffer): void {
    this.emit('job', offer);
  }

  completeJob(result: JobResult): void {
    this.emit('jobComplete', result);
  }
}

export const jobBoard = new JobBoard();
