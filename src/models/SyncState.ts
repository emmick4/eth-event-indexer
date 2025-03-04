import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity()
export class SyncState {
  @PrimaryColumn()
  id: string = 'main'; // We'll just use a single record

  @Column()
  lastSyncedBlock: number = 0;

  @Column()
  lastSyncedAt: Date = new Date();
} 