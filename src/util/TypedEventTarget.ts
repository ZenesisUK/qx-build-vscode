type CustomEventMap = {
  [K in string]: Event & { readonly type: K };
};

export class TypedEventTarget<EventMap extends CustomEventMap> {
  private target = new EventTarget();

  public on<T extends keyof EventMap & string>(type: T, listener: (evt: EventMap[T]) => void): void {
    this.target.addEventListener(type, listener as (evt: Event) => void);
  }

  public dispatchEvent<T extends keyof EventMap & string>(event: EventMap[T]): boolean {
    return this.target.dispatchEvent(event);
  }

  public off<T extends keyof EventMap & string>(type: T, listener: (evt: EventMap[T]) => void): void {
    this.target.removeEventListener(type, listener as (evt: Event) => void);
  }
}
