import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { Task, TaskStatus } from './task.model';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) { }

  @Get()
  findAll(): Task[] {
    return this.tasksService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Task {
    return this.tasksService.findOne(id);
  }

  @Post()
  create(@Body() body: { title: string; description: string }): Task {
    return this.tasksService.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { title?: string; description?: string; status?: TaskStatus },
  ): Task {
    return this.tasksService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string): void {
    this.tasksService.remove(id);
  }
}
