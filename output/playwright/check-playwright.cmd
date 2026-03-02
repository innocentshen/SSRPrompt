@echo off
npx --yes --package playwright -c "node -e \"console.log(require.resolve('playwright'))\""
