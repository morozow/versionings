import { Injectable, NotFoundException } from '@nestjs/common';
import { Task, TaskStatus } from './task.model';
import { randomUUID } from 'crypto';

@Injectable()
export class TasksService {
  private readonly tasks = new Map<string, Task>();

  findAll(): Task[] {
    return Array.from(this.tasks.values());
  }

  findOne(id: string): Task {
    const task = this.tasks.get(id);
    if (!task) {
      throw new NotFoundException(`Task with id "${id}" not found`);
    }
    return task;
  }

  create(dto: { title: string; description: string }): Task {
    const task: Task = {
      id: randomUUID(),
      title: dto.title,
      description: dto.description,
      status: TaskStatus.OPEN,
      createdAt: new Date(),
    };
    this.tasks.set(task.id, task);
    return task;
  }

  update(id: string, dto: { title?: string; description?: string; status?: TaskStatus }): Task {
    const task = this.findOne(id);
    if (dto.title !== undefined) {
      task.title = dto.title;
    }
    if (dto.description !== undefined) {
      task.description = dto.description;
    }
    if (dto.status !== undefined) {
      task.status = dto.status;
    }
    this.tasks.set(id, task);
    return task;
  }

  remove(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      throw new NotFoundException(`Task with id "${id}" not found`);
    }
    this.tasks.delete(id);
  }
}
