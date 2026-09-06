import { WebSocketGateway, SubscribeMessage, MessageBody } from '@nestjs/websockets';

@WebSocketGateway()
export class EchoGateway {
  @SubscribeMessage('echo')
  handleEcho(@MessageBody() data: unknown): unknown {
    return data;
  }
}
