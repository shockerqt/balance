.PHONY: dev build check test

dev:
	pnpm dev

mobile:
	pnpm mobile

check:
	cargo check -p server

build:
	pnpm --filter dashboard build && cargo build -p server

test:
	pnpm --filter dashboard test && cargo test -p server
