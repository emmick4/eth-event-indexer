import WebSocket from 'ws';
import http from 'http';
import { TransferEvent } from '../models/TransferEvent';

export class WebSocketService {
  private wss: WebSocket.Server;
  private clients: Set<WebSocket> = new Set();

  constructor(server: http.Server) {
    this.wss = new WebSocket.Server({ server });
    this.setupWebSocketServer();
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('WebSocket client connected');
      this.clients.add(ws);

      // Send initial message
      ws.send(JSON.stringify({ type: 'info', message: 'Connected to ERC-20 Transfer event stream' }));

      ws.on('close', () => {
        console.log('WebSocket client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });
  }

  public broadcastEvent(event: TransferEvent): void {
    const eventData = JSON.stringify({
      type: 'transferEvent',
      data: {
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        timestamp: event.timestamp,
        from: event.from,
        to: event.to,
        value: event.value
      }
    });

    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(eventData);
      }
    });
  }

  public getClientCount(): number {
    return this.clients.size;
  }
} 