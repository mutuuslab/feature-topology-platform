import { Module } from '@nestjs/common';
import { BinaryStore } from './binary-store';

/** Shared byte storage. Importers retain their own domain authorization and attachment transaction. */
@Module({providers:[BinaryStore],exports:[BinaryStore]})
export class BinaryStorageModule {}
