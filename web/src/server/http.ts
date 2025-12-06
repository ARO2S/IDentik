import { NextResponse } from 'next/server';

interface JsonResponseInit extends ResponseInit {
  headers?: HeadersInit;
}

export const json = <T>(data: T, init: JsonResponseInit = {}) => {
  return NextResponse.json(data, init);
};

export const badRequest = (message: string) =>
  json({ error: message }, { status: 400 });

export const unauthorized = (message = 'You need to be signed in to do that.') =>
  json({ error: message }, { status: 401 });

export const forbidden = (message = 'You are not allowed to do that.') =>
  json({ error: message }, { status: 403 });

export const notFound = (message = 'Not found.') =>
  json({ error: message }, { status: 404 });

export const serverError = (message = 'Something went wrong.') =>
  json({ error: message }, { status: 500 });
