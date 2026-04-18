import { faker } from '@faker-js/faker';

export interface ColumnSchema {
  name: string;
  type: string;
  udt_type?: string;
}

type GeneratorType =
  | 'name' | 'email' | 'phone' | 'address' | 'uuid'
  | 'integer' | 'float' | 'boolean' | 'date'
  | 'paragraph' | 'sentence' | 'word' | 'custom_list'
  | 'ipv4' | 'ipv6' | 'mac';

export class SeedingService {
  private generators: Record<string, () => unknown> = {
    name: () => faker.person.fullName(),
    email: () => faker.internet.email(),
    phone: () => faker.phone.number(),
    address: () => faker.location.streetAddress({ useFullAddress: true }),
    uuid: () => faker.string.uuid(),
    integer: () => faker.number.int({ min: 1, max: 10000 }),
    float: () => faker.number.float({ min: 0, max: 10000, fractionDigits: 2 }),
    boolean: () => faker.datatype.boolean(),
    date: () => faker.date.past().toISOString().split('T')[0],
    paragraph: () => faker.lorem.paragraph(),
    sentence: () => faker.lorem.sentence(),
    word: () => faker.lorem.word(),
    custom_list: () => faker.helpers.arrayElement(['alpha', 'beta', 'gamma', 'delta']),
    ipv4: () => faker.internet.ip(),
    ipv6: () => faker.internet.ipv6(),
    mac: () => faker.internet.mac(),
  };

  generateRecords(
    _schema: string,
    _tableName: string,
    columns: ColumnSchema[],
    count: number,
    generatorMap: Record<string, string>
  ): Record<string, unknown>[] {
    const records: Record<string, unknown>[] = [];
    const skipColumns = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);

    for (let i = 0; i < count; i++) {
      const record: Record<string, unknown> = {};

      for (const col of columns) {
        if (skipColumns.has(col.name)) continue;

        const generatorType = generatorMap[col.name];
        if (!generatorType) continue;

        const generator = this.generators[generatorType];
        if (generator) {
          record[col.name] = generator();
        } else {
          record[col.name] = this.generateByColumnType(col.type, col.udt_type);
        }
      }

      records.push(record);
    }

    return records;
  }

  getDefaultGenerator(columnType: string, udtType?: string): string {
    const type = (udtType ?? columnType).toLowerCase();

    if (type === 'uuid') return 'uuid';
    if (type === 'inet' || type === 'cidr') return 'ipv4';
    if (type === 'macaddr') return 'mac';
    if (type.includes('bool')) return 'boolean';
    if (type.includes('int') || type === 'serial' || type === 'bigserial') return 'integer';
    if (type.includes('float') || type.includes('double') || type.includes('decimal') || type.includes('numeric')) return 'float';
    if (type.includes('date') || type.includes('timestamp')) return 'date';
    if (type.includes('text') || type.includes('char') || type.includes('varchar')) return 'sentence';
    if (type === 'jsonb' || type === 'json') return 'word';

    return 'word';
  }

  private generateByColumnType(type: string, udtType?: string): unknown {
    const generatorType = this.getDefaultGenerator(type, udtType);
    const generator = this.generators[generatorType];
    return generator ? generator() : null;
  }
}
