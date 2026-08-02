.PHONY: dev build check test mobile

dev:
	pnpm dev

mobile:
	npm run mobile 2>&1 | tee /tmp/metro.log

check:
	cargo check -p server

build:
	pnpm --filter dashboard build && cargo build -p server

test:
	pnpm --filter dashboard test && cargo test -p server
