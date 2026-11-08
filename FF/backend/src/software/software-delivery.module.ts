import { Module } from '@nestjs/common';
import { BinaryStorageModule } from '../kernel/binary-storage.module';
import { D01PolicyModule } from '../domains/d01-policy/d01-policy.module';
import { TrustModule } from '../domains/d06-qsec/pki-kms/trust.module';
import { SoftwareDeliveryService } from './software-delivery.service';
import { SoftwareDeliveryController,VehicleSoftwareController } from './software-delivery.controller';
@Module({imports:[BinaryStorageModule,D01PolicyModule,TrustModule],controllers:[SoftwareDeliveryController,VehicleSoftwareController],providers:[SoftwareDeliveryService],exports:[SoftwareDeliveryService]})
export class SoftwareDeliveryModule {}
