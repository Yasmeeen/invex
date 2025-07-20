import express from 'express';
import bootstrap from './src/bootstrap.js';


const app = express();

// Setup app
bootstrap(app, express);

