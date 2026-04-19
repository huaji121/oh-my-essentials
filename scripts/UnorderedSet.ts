export class UnorderedSet<T> {
  public items: T[] = [];
  has(item: T): boolean {
    return this.items.indexOf(item) !== -1;
  }

  add(item: T): void {
    if (this.has(item)) return;
    this.items.push(item);
  }

  delete(item: T): void {
    // 和最后一个交换位置
    const index = this.items.indexOf(item);
    if (index !== -1) {
      const lastIndex = this.items.length - 1;
      [this.items[index], this.items[lastIndex]] = [this.items[lastIndex], this.items[index]];
      this.items.pop();
    }
  }

  clear(): void {
    this.items = [];
  }
}
