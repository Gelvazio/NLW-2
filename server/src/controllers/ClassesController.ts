import { Request, Response } from 'express';
import database from '../database/connection';
import convertHoursToMinutes from '../utils/convertHoursToMinutes';

interface ScheduleItem {
  week_day: number;
  from: string;
  to: string;
}

export default class ClassesController {
  // Listagem
  async index(request: Request, response: Response) {
    const filters = request.query;

    const subject = filters.subject as string;
    const week_day = filters.week_day as string;
    const time = filters.time as string;

    if (!filters.week_day || !filters.subject || !filters.time) {
      return response
        .status(400)
        .json({ error: 'Missing filters to search classes.' });
    }

    const timeInMinutes = convertHoursToMinutes(filters.time as string);

    const classes = await database('classes')
      .whereExists(function () {
        this.select('class_schedule.*')
          .from('class_schedule')
          .whereRaw('`class_schedule`.`class_id` = `classes`.`id`')
          .whereRaw('`class_schedule`.`week_day` = ??', [
            Number(filters.week_day as string),
          ])
          .whereRaw('`class_schedule`.`from` <= ??', [timeInMinutes])
          // Cuidado! "to", não "from"
          .whereRaw('`class_schedule`.`to` > ??', [timeInMinutes]);
      })
      .where('classes.subject', '=', filters.subject as string)
      .join('users', 'classes.user_id', '=', 'users.id')
      .select(['classes.*', 'users.*']);

    return response.json(classes);
  }

  // Criação
  async create(request: Request, response: Response) {
    const {
      name,
      avatar,
      whatsapp,
      bio,
      subject,
      cost,
      schedule,
    } = request.body;

    const transaction = await database.transaction();

    const insertedUsersIds = await transaction('users').insert({
      name,
      avatar,
      whatsapp,
      bio,
    });

    const user_id = insertedUsersIds[0];

    try {
      const insertedClassesIds = await transaction('classes').insert({
        subject,
        cost,
        user_id,
      });

      const class_id = insertedClassesIds[0];

      const classSchedule = schedule.map((scheduleItem: ScheduleItem) => {
        return {
          class_id,
          week_day: scheduleItem.week_day,
          from: convertHoursToMinutes(scheduleItem.from),
          to: convertHoursToMinutes(scheduleItem.to),
        };
      });

      await transaction('class_schedule').insert(classSchedule);

      // Final da Transaction
      await transaction.commit();

      return response.status(201).send();
    } catch (err) {
      // Caso tenha dado algum erro, qualquer alteracao no DB é desfeita
      await transaction.rollback();

      return response.status(400).json({
        error: 'Unexpected error while creating new class.',
      });
    }
  }
}
