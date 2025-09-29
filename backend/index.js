import express from 'express';
import bootstrap from './src/bootstrap.js';
import dotenv from 'dotenv';

dotenv.config();
const app = express();

// Setup app
bootstrap(app, express);

