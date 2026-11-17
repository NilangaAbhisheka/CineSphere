import { Injectable } from '@nestjs/common';

export interface IClock {
  now(): Date;
}

export const CLOCK_TOKEN = Symbol('IClock');

@Injectable()
export class SystemClock implements IClock {
  public now(): Date {
    return new Date();
  }
}
