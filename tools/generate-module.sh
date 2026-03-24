#!/bin/bash
# Generate NestJS module scaffold
# Usage: ./tools/generate-module.sh <module-name>
# Example: ./tools/generate-module.sh warranties

set -e

if [ -z "$1" ]; then
  echo "Usage: ./tools/generate-module.sh <module-name>"
  echo "Example: ./tools/generate-module.sh warranties"
  exit 1
fi

MODULE_NAME="$1"
MODULE_DIR="apps/api/src/modules/$MODULE_NAME"

# Convert to PascalCase for class names
PASCAL_NAME=$(echo "$MODULE_NAME" | sed -r 's/(^|[-_])(\w)/\U\2/g')
# Convert to singular if ends with 's' (simple heuristic)
SINGULAR=$(echo "$PASCAL_NAME" | sed 's/s$//')

if [ -d "$MODULE_DIR" ]; then
  echo "Error: Module '$MODULE_NAME' already exists at $MODULE_DIR"
  exit 1
fi

echo "Creating module: $MODULE_NAME ($PASCAL_NAME)"
mkdir -p "$MODULE_DIR/dto"

# Module file
cat > "$MODULE_DIR/$MODULE_NAME.module.ts" << EOF
import { Module } from '@nestjs/common';
import { ${PASCAL_NAME}Controller } from './${MODULE_NAME}.controller';
import { ${PASCAL_NAME}Service } from './${MODULE_NAME}.service';

@Module({
  controllers: [${PASCAL_NAME}Controller],
  providers: [${PASCAL_NAME}Service],
  exports: [${PASCAL_NAME}Service],
})
export class ${PASCAL_NAME}Module {}
EOF

# Controller file
cat > "$MODULE_DIR/$MODULE_NAME.controller.ts" << EOF
import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { RolesGuard } from '../../guards/roles.guard';
import { Roles } from '../../guards/roles.decorator';
import { ${PASCAL_NAME}Service } from './${MODULE_NAME}.service';
import { Create${SINGULAR}Dto, Update${SINGULAR}Dto } from './dto/${MODULE_NAME}.dto';

@Controller('${MODULE_NAME}')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ${PASCAL_NAME}Controller {
  constructor(private readonly ${MODULE_NAME}Service: ${PASCAL_NAME}Service) {}

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.${MODULE_NAME}Service.findAll({ search, page: page || 1, limit: limit || 50 });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.${MODULE_NAME}Service.findOne(id);
  }

  @Post()
  create(@Body() dto: Create${SINGULAR}Dto, @Req() req) {
    return this.${MODULE_NAME}Service.create(dto, req.user.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Update${SINGULAR}Dto) {
    return this.${MODULE_NAME}Service.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER')
  remove(@Param('id') id: string) {
    return this.${MODULE_NAME}Service.remove(id);
  }
}
EOF

# Service file
cat > "$MODULE_DIR/$MODULE_NAME.service.ts" << EOF
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Create${SINGULAR}Dto, Update${SINGULAR}Dto } from './dto/${MODULE_NAME}.dto';

@Injectable()
export class ${PASCAL_NAME}Service {
  constructor(private prisma: PrismaService) {}

  async findAll(params: { search?: string; page: number; limit: number }) {
    const { search, page, limit } = params;
    const skip = (page - 1) * limit;

    const where = {
      deletedAt: null,
      ...(search && {
        OR: [
          // Add searchable fields here
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma./* MODEL */.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma./* MODEL */.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma./* MODEL */.findUnique({ where: { id } });
    if (!record || record.deletedAt) {
      throw new NotFoundException('ไม่พบข้อมูล');
    }
    return record;
  }

  async create(dto: Create${SINGULAR}Dto, userId: string) {
    return this.prisma./* MODEL */.create({
      data: { ...dto },
    });
  }

  async update(id: string, dto: Update${SINGULAR}Dto) {
    await this.findOne(id);
    return this.prisma./* MODEL */.update({
      where: { id },
      data: { ...dto },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma./* MODEL */.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
EOF

# DTO file
cat > "$MODULE_DIR/dto/$MODULE_NAME.dto.ts" << EOF
import { IsString, IsOptional } from 'class-validator';

export class Create${SINGULAR}Dto {
  @IsString({ message: 'กรุณาระบุข้อมูล' })
  name: string;
}

export class Update${SINGULAR}Dto {
  @IsOptional()
  @IsString()
  name?: string;
}
EOF

echo ""
echo "Module created at: $MODULE_DIR/"
echo "Files:"
echo "  - $MODULE_NAME.module.ts"
echo "  - $MODULE_NAME.controller.ts"
echo "  - $MODULE_NAME.service.ts"
echo "  - dto/$MODULE_NAME.dto.ts"
echo ""
echo "Next steps:"
echo "  1. Replace /* MODEL */ placeholders in service with actual Prisma model name"
echo "  2. Update DTOs with actual fields"
echo "  3. Add module import to apps/api/src/app.module.ts"
echo "  4. Run: cd apps/api && npx tsc --noEmit"
