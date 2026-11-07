import {
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

export function isHalfStepRating(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value !== 'number' || isNaN(value)) {
    return false;
  }
  return value >= 1.0 && value <= 10.0 && Number.isInteger(Math.round(value * 100) / 50);
}

export function IsHalfStepRating(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isHalfStepRating',
      target: object.constructor,
      propertyName: propertyName,
      options: {
        message: 'Rating must be a number between 1.00 and 10.00 in increments of 0.5 (e.g. 7.0, 7.5).',
        ...validationOptions,
      },
      validator: {
        validate(value: unknown): boolean {
          return isHalfStepRating(value);
        },
      },
    });
  };
}
