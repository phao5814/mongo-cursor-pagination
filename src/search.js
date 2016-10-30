var _ = require('underscore');
var config = require('./config');
var bsonUrlEncoding = require('./utils/bsonUrlEncoding');

/**
 * Performs a search query on a Mongo collection and pages the results. This is different from
 * find() in that the results are ordered by their relevancy, and as such, it does not take
 * a paginatedField parameter. Note that this is less performant than find() because it must
 * perform the full search on each call to this function. Also note that results might change
 *
 * @param {MongoCollection} collection A collection object returned from the MongoDB library's
 *    `db.collection(<collectionName>)` method. This MUST have a Mongo $text index on it.
 *    See https://docs.mongodb.com/manual/core/index-text/.
 * @param {String} searchString String to search on.
 * @param {Object} params
 *    -query {Object} The find query.
 *    -limit {Number} The page size. Must be between 1 and `config.MAX_LIMIT`.
 *    -fields {Object} Fields to query in the Mongo object format, e.g. {title :1}.
 *      The default is to query ONLY _id (note this is a difference from `find()`).
 *    -next {String} The value to start querying the page. Defaults to start at the beginning of
 *      the results.
 * @param {Function} done Node errback style function.
 */
module.exports = function(collection, searchString, params, done) {
  if (_.isString(params.limit)) params.limit = parseInt(params.limit);
  if (params.next) params.next = bsonUrlEncoding.decode(params.next);

  params = _.defaults(params, {
    query: {},
    limit: config.MAX_LIMIT
  });

  if (params.limit < 1) params.limit = 1;
  if (params.limit > config.MAX_LIMIT) params.limit = config.MAX_LIMIT;

  // We must perform an aggregate query since Mongo can't query a range when using $text search.

  var aggregate = [{
    $match: _.extend({}, params.query, {
      $text: {
        $search: searchString
      }
    })
  }, {
    $project: _.extend({}, params.fields, {
      _id: 1,
      score: {
        $meta: 'textScore'
      }
    })
  }, {
    $sort: {
      score: {
        $meta: 'textScore'
      },
      _id: -1
    }
  }];

  if (params.next) {
    aggregate.push({
      $match: {
        $or: [{
          score: {
            $lt: params.next[0]
          }
        }, {
          score: {
            $eq: params.next[0]
          },
          _id: {
            $lt: params.next[1]
          }
        }]
      }
    });
  }

  aggregate.push({
    $limit: params.limit
  });

  collection.aggregate(aggregate, (err, results) => {
    if (err) {
      done(err);
      return;
    }

    var response;
    var fullPageOfResults = (results.length === params.limit);
    if (fullPageOfResults) {
      response = {
        results,
        next: bsonUrlEncoding.encode([_.last(results).score, _.last(results)._id])
      };
    } else {
      response = {
        results
      };
    }

    done(null, response);
  });
};