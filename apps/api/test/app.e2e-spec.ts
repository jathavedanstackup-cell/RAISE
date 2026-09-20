import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // CP7 added a @WebSocketGateway() to AppModule -- Nest's default driver detection needs
    // socket.io, which this repo doesn't install (uses native ws instead).
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect((res) => {
        if (!res.text.includes('RAISE API')) {
          throw new Error(`Unexpected response body: ${res.text}`);
        }
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
