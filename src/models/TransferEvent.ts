import { Entity, Column, PrimaryColumn, Index, CreateDateColumn } from 'typeorm';

@Entity()
export class TransferEvent {
  @PrimaryColumn()
  transactionHash: string;

  @Column()
  @Index()
  blockNumber: number;

  @Column()
  timestamp: number;

  @Column()
  @Index()
  from: string;

  @Column()
  @Index()
  to: string;

  @Column('text')
  value: string; // Store as string to handle large numbers

  @Column({ nullable: true })
  logIndex: number;

  @CreateDateColumn()
  indexedAt: Date;
} 