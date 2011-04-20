sc_require('views/template');

SC.TemplateCollectionView = SC.TemplateView.extend({
  tagName: 'ul',
  content: null,
  template: SC.Handlebars.compile(''),
  emptyView: null,

  /**
    @private
    When the view is initialized, set up array observers on the content array.

    @returns SC.TemplateCollectionView
  */
  init: function() {
    var templateCollectionView = sc_super();
    this._sctcv_contentDidChange();
    return templateCollectionView;
  },

  // In case a default content was set, trigger the child view creation
  // as soon as the empty layer was created
  didCreateLayer: function() {
    var content = this.get('content');
    if(content) {
      this.arrayContentDidChange(0, 0, content.get('length'));
    }
  },

  itemView: 'SC.TemplateView',

  /**
    The template used to render each item in the collection.

    This should be a function that takes a content object and returns
    a string of HTML that will be inserted into the DOM.

    In general, you should set the `itemViewTemplateName` property instead of
    setting the `itemViewTemplate` property yourself. If you created the
    SC.TemplateCollectionView using the Handlebars {{#collection}} helper, this
    will be set for you automatically.

    @type Function
  */
  itemViewTemplate: null,

  /**
    The name of the template to lookup if no item view template is provided.

    The collection will look for a template with this name in the global
    `SC.TEMPLATES` hash. Usually this hash will be populated for you
    automatically when you include `.handlebars` files in your project.

    @type String
  */
  itemViewTemplateName: null,

  itemContext: null,

  itemViewClass: function() {
    var itemView = this.get('itemView');
    var itemViewTemplate = this.get('itemViewTemplate');
    var itemViewTemplateName = this.get('itemViewTemplateName');

    // hash of properties to override in our
    // item view class
    var extensions = {};

    if(SC.typeOf(itemView) === SC.T_STRING) {
      itemView = SC.objectForPropertyPath(itemView);
    }

    if (!itemViewTemplate && itemViewTemplateName) {
      itemViewTemplate = this.get('templates').get(itemViewTemplateName);
    }

    if (itemViewTemplate) {
      extensions.template = itemViewTemplate;
    }

    if (this.get('tagName') === 'ul' || this.get('tagName') === 'ol') {
      extensions.tagName = 'li';
    }

    return itemView.extend(extensions);
  }.property('itemView').cacheable(),

  /**
    @private

    When the content property of the collection changes, remove any existing
    child views and observers, then set up an observer on the new content, if
    needed.
  */
  _sctcv_contentDidChange: function() {

    this.$().empty();

    var oldContent = this._content, oldLen = 0;
    var content = this.get('content'), newLen = 0;

    if (oldContent) {
      oldContent.removeArrayObservers({
        target: this,
        willChange: 'arrayContentWillChange',
        didChange: 'arrayContentDidChange'
      });

      oldLen = oldContent.get('length');
    }

    if (content) {
      content.addArrayObservers({
        target: this,
        willChange: 'arrayContentWillChange',
        didChange: 'arrayContentDidChange'
      });

      newLen = content.get('length');
    }

    this.arrayContentWillChange(0, oldLen, newLen);
    this._content = this.get('content');
    this.arrayContentDidChange(0, oldLen, newLen);
  }.observes('content'),

  arrayContentWillChange: function(start, removedCount, addedCount) {
    // If the contents were empty before and this template collection has an empty view
    // remove it now.
    emptyView = this.get('emptyView');
    if (emptyView) { emptyView.$().remove(); emptyView.removeFromParent(); }

    // Loop through child views that correspond with the removed items.
    // Note that we loop from the end of the array to the beginning because
    // we are mutating it as we go.
    var childViews = this.get('childViews'), childView, idx, len;

    len = childViews.get('length');
    for (idx = start+removedCount-1; idx >= start; idx--) {
      childView = childViews[idx];
      childView.$().remove();
      childView.removeFromParent();
      childView.destroy();
    }
  },

  /**
    Called when a mutation to the underlying content array occurs.

    This method will replay that mutation against the views that compose the
    SC.TemplateCollectionView, ensuring that the view reflects the model.

    This enumerable observer is added in contentDidChange.

    @param {Array} addedObjects the objects that were added to the content
    @param {Array} removedObjects the objects that were removed from the content
    @param {Number} changeIndex the index at which the changes occurred
  */
  arrayContentDidChange: function(start, removedCount, addedCount) {
    if (!this.get('layer')) { return; }

    var content       = this.get('content'),
        itemViewClass = this.get('itemViewClass'),
        childViews    = this.get('childViews'),
        addedViews    = [],
        renderFunc, childView, itemOptions, elem, insertAtElement, item, itemElem, idx, len;

    var addedObjects = content.slice(start, start+addedCount);

    // If we have content to display, create a view for
    // each item.
    itemOptions = this.get('itemViewOptions') || {};

    elem = this.$();
    insertAtElement = elem.find('li')[start-1] || null;
    len = addedObjects.get('length');

    // TODO: This logic is duplicated from the view helper. Refactor
    // it so we can share logic.
    var itemAttrs = {
      "id": itemOptions.id,
      "class": itemOptions['class'],
      "classBinding": itemOptions.classBinding
    };

    renderFunc = function(context) {
      sc_super();
      SC.Handlebars.ViewHelper.applyAttributes(itemAttrs, this, context);
    };

    itemOptions = SC.clone(itemOptions);
    delete itemOptions.id;
    delete itemOptions['class'];
    delete itemOptions.classBinding;

    for (idx = 0; idx < len; idx++) {
      item = addedObjects.objectAt(idx);
      view = this.createChildView(itemViewClass.extend(itemOptions, {
        content: item,
        render: renderFunc
      }));

      var contextProperty = view.get('contextProperty');
      if (contextProperty) {
        view.set('context', view.get(contextProperty));
      }

      itemElem = view.createLayer().$();
      if (!insertAtElement) {
        elem.append(itemElem);
      } else {
        itemElem.insertAfter(insertAtElement);
      }
      insertAtElement = itemElem;

      addedViews.push(view);
    }

    childViews.replace(start, 0, addedViews);

    var inverseTemplate = this.get('inverseTemplate');
    if (childViews.get('length') === 0 && inverseTemplate) {
      view = this.createChildView(SC.TemplateView.extend({
        template: inverseTemplate,
        content: this
      }));
      this.set('emptyView', view);
      view.createLayer().$().appendTo(elem);
      this.childViews = [view];
    }

    // Because the layer has been modified, we need to invalidate the frame
    // property, if it exists, at the end of the run loop. This allows it to
    // be used inside of SC.ScrollView.
    this.invokeLast('invalidateFrame');
  },

  invalidateFrame: function() {
    this.notifyPropertyChange('frame');
  }
});

