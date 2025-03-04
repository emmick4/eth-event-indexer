import { Entity, Column, PrimaryColumn, Index, CreateDateColumn } from 'typeorm';

@Entity()
export class TransferEvent {
  @PrimaryColumn()
  transactionHash: string = '';

  @Column()
  @Index()
  blockNumber: number = 0;

  @Column()
  timestamp: number = 0;

  @Column()
  @Index()
  from: string = '';

  @Column()
  @Index()
  to: string = '';

  @Column('text')
  value: string = '0'; // Store as string to handle large numbers

  @Column({ nullable: true })
  logIndex: number = 0;

  @CreateDateColumn()
  indexedAt: Date = new Date();
} 