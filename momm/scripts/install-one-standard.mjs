import {setupReviewerClis, standardReviewers} from './reviewer-install.mjs';

// Private Setup Center child. Both launchers use the same missing-only installer.
const agent = process.argv[2];
if (process.argv.length !== 3 || !standardReviewers.includes(agent)) throw Error('Expected one standard reviewer');
const result = await setupReviewerClis({apply:true, onlyStandardReviewer:agent});
process.stdout.write(JSON.stringify(result.reviewers[0]));
